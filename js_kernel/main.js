class ProcessExit extends Error {
    constructor(status = 0) {
        super(`Process exited with status ${status}`);

        this.name = "ProcessExit";
        this.status = status;
    }
}

/**
    * @param {Env} env 
    */
async function dlopen(id, execPath, env, mod, file) {
    mod = readCString(env.mem, mod);
    file = readCString(env.mem, file);
    const final_name = `__dlopen__:${mod}${id}`;
    const path = PathBuf.parse(execPath);
    path.pop();
    path.push(file);
    file = path.toString();
    const source = await FS.read(file);
    if (source === null) return 1;
    const buffer = new Uint8Array(source);

    const module = await env.thread.compile(buffer);
    const imports = WebAssembly.Module.imports(module);
    await resolve_imports(imports, env, file);
    const memoryBase = env.dlmem[final_name].memoryBase;
    const tableBase = env.dlmem[final_name].tableBase;
    env.handles.env.__memory_base = await global.i32(env.thread, memoryBase);
    env.handles.env.__table_base = await global.i32(env.thread, tableBase);
    const instance = await env.thread.instantiate(module, env.handles);

    env.dlhandles[final_name] = instance.exports;
    env.dlinstanceid.set(final_name, instance.instanceId);
    return 0
}

syscall(dlopen);

function execpath(_, execPath, env, buf, size) {
    return writeCString(env.mem, buf, size, execPath);
}
syscall(execpath);

function cwd(_, execPath, env, buf, size) {
    return writeCString(env.mem, buf, size, env.cwd.toString());
}
syscall(cwd);


/**
    * @param {Env} env 
    */
function getvar(_, execPath, env, v, buf, size) {
    return writeCString(env.mem, buf, size, env.vars.get(readCString(v)));
}
syscall(getvar);

/**
    * @param {Env} env 
    */
function setvar(_, execPath, env, v, val) {
    env.vars.set(readCString(v), readCString(val));
}
syscall(setvar);

/**
    * @param {Env} env 
    */
function unsetvar(_, execPath, env, v) {
    env.vars.delete(readCString(v));
}
syscall(unsetvar);

/**
    * @param {Env} env 
    */
function hasvar(_, execPath, env, v) {
    return env.vars.has(readCString(v)) ? 1 : 0;
}
syscall(hasvar);

function readArgv(memory, argc, argv) {
    const view = new DataView(memory.buffer);
    const args = [];

    for (let i = 0; i < argc; i++) {
        const ptr = view.getUint32(argv + i * 4, true);
        args.push(readCString(memory, ptr));
    }

    return args;
}

function spawn(_, _, env, path, argc, argv) {
    const childEnv = env.cloneVars();

    const args = readArgv(env.mem, argc, argv);

    const promise = run_from_path(path, {
        env: childEnv,
        stderr: Descriptor.get(2).dup(childEnv),
        stdout: Descriptor.get(1).dup(childEnv),
        stdin: Descriptor.get(0).dup(childEnv),
        argv: args,
    });

    return env.allocateProcess(childEnv, promise);
}

syscall(spawn);

/**
    * @param {Env} env 
    */
async function wait(_, _, env, pid) {
    const r = await env.processes.handles[pid].promise;
    env.freeProcess(pid);
    return r;
}
syscall(wait);

/**
    * @param {Env} env 
    */
function detach(_, _, env, pid) {
    env.processes.handles[pid].promise.then(v => {
        env.freeProcess(pid);
    });
}
syscall(detach);


function exit(_, execPath, env, status) {
    throw new ProcessExit(status);
}
syscall(exit);


/**
    * @param {Env} env 
    */
async function findpath(_, execPath, env, v, file, buf, size) {
    return writeCString(env.mem, buf, size, await env.find(readCString(v), readCString(file)));
}
syscall(findpath);

/**
    * @param {Env} env 
    */
async function chdir(_, execPath, env, path) {
    path = readCString(env.mem, path);
    const test = env.cwd.clone();
    test.push(path);
    if (await FS.readdir(test) === null) return 1
    env.cwd.push(path);
    return 0;
}
syscall(chdir);


/**
    * @param {Env} env 
    */
async function dlclose(id, execPath, env, mod) {
    mod = readCString(env.mem, mod);
    const final_name = `__dlopen__:${mod}${id}`;

    const instanceId = env.dlinstanceid.get(final_name);
    await env.thread.close(instanceId);
    env.dlinstanceid.delete(final_name);
    env.dlhandles[final_name] = null;
}

syscall(dlclose);

/**
    * @param {WebAssembly.ModuleImportDescriptor[]} imports 
    * @param {Env} env 
    */
async function resolve_imports(imports, env, filePath) {
    env.handles.env = {
        mem: env.mem,
        __stack_pointer: await env.stackPointer(env.thread),
    }
    const add = [];
    const id = crypto.randomUUID();
    for (const imp of imports) {
        if (imp.module.startsWith("__dlopen__:")) {
            //TASK(20260728-133956-369-n6-135): add an id for the module
            imp.module += `:${id}`;
            if (!env.handles[imp.module]) {
                env.handles[imp.module] = {};
                env.dlhandles[imp.module] = null;
                const tableBase = env.allocateTable(31, 4);
                const memoryBase = env.allocate(4096, 16);
                env.dlmem[imp.module] = {
                    tableBase,
                    memoryBase,
                }
            }
            if (imp.kind === "function") {
                env.handles[imp.module][imp.name] = async (...args) => {
                    if (!env.dlhandles?.[imp.module]?.[imp.name]) {
                        console.warn(`unresolved function '${imp.name}' from module '${imp.module}' got called`);
                        return;
                    }
                    const fn = env.dlhandles[imp.module][imp.name];
                    return await fn(...args);
                };
            }
            continue;
        }
        if (["env", "."].includes(imp.module)) continue;
        if (!env.handles[imp.module]) {
            env.dlhandles[imp.module] = null;
            env.handles[imp.module] = {};
            add.push(imp.module);
        }
        if (imp.kind === "function") {
            if (env.handles[imp.module][imp.name]) continue;
            env.handles[imp.module][imp.name] = async (...args) => {
                const fn = env.dlhandles[imp.module][imp.name];
                return await fn(...args);
            };
        }
    }
    //check that all requirements are met
    for (const modname of add) {
        if (!env.dlhandles[modname]) {
            const file = await (async () => {
                if (modname.startsWith("__file__:")) {
                    const path = PathBuf.parse(filePath);
                    path.pop();
                    path.push(modname.slice(9));
                    return path.toString();
                }
                return await env.find("LIBPATH", modname);
            })()
            if (env.imported_libs.has(file)) {
                env.dlhandles[modname] = env.imported_libs.get(file);
                continue;
            }
            const source = await FS.read(file);
            if (source === null) throw new Error("doesn't exist");
            const buffer = new Uint8Array(source);

            const module = await env.thread.compile(buffer);
            const imports = WebAssembly.Module.imports(module);
            await resolve_imports(imports, env, file);
            const memoryBase = env.allocate(4096, 16);
            const tableBase = env.allocateTable(31, 4);
            console.log("created", modname)
            env.handles.env.__memory_base = await global.i32(env.thread, memoryBase);
            env.handles.env.__table_base = await global.i32(env.thread, tableBase);
            const instance = await env.thread.instantiate(module, env.handles);
            env.instanceid.push(instance.instanceId);
            env.imported_libs.set(file, instance.exports)
            env.dlhandles[modname] = instance.exports;
        }
        for (const needed in env.handles[modname]) {
            if (!env.dlhandles[modname][needed]) throw new Error(`required ${modname}:${needed} not found`);
        }
    }
    env.handles["."] = make_syscalls(id, filePath, env);
}

async function create_wasm(filePath, buffer, env = new Env) {
    const thread = create_thread();
    env.thread = thread;

    const module = await thread.compile(buffer);
    const imports = WebAssembly.Module.imports(module);

    await resolve_imports(imports, env, filePath);

    env.handles.env.__memory_base = await global.i32(thread, 0);
    env.handles.env.__table_base = await global.i32(thread, 0);

    const instance = await thread.instantiate(module, env.handles);

    env.instanceid.push(instance.instanceId);

    return [instance.exports, env];
}

function allocateArgv(env, args) {
    const encoder = new TextEncoder();

    // Encode all arguments, including their null terminators.
    const strings = args.map(arg =>
        encoder.encode(String(arg) + "\0")
    );

    const totalSize = strings.reduce(
        (total, str) => total + str.length, 0
    );

    // Allocate all strings together.
    const storage = env.allocate(totalSize, 1);

    // Allocate the pointer array.
    const argv = env.allocate((args.length + 1) * 4, 4);

    const bytes = new Uint8Array(env.mem.buffer);
    const view = new DataView(env.mem.buffer);

    let offset = 0;

    for (let i = 0; i < strings.length; i++) {
        const ptr = storage + offset;

        bytes.set(strings[i], ptr);
        view.setUint32(argv + i * 4, ptr, true);

        offset += strings[i].length;
    }

    // NULL terminator.
    view.setUint32(argv + args.length * 4, 0, true);

    return argv;
}

async function run_from_path(path, {
    stdin = Descriptor.empty(),
    stdout = Descriptor.empty(),
    stderr = Descriptor.empty(),
    env = new Env(),
    argv = []
} = {}) {
    try {
        const source = await FS.read(path);

        if (source === null) {
            throw new Error(`Executable not found: ${path}`);
        }

        stdin.dup(env, [0, "ignore"], O_RDONLY);
        stdout.dup(env, [1, "ignore"], O_RDWR);
        stderr.dup(env, [2, "ignore"], O_RDWR);

        const buffer = new Uint8Array(source);
        const [exports] = await create_wasm(path, buffer, env);

        if (typeof exports.main !== "function") {
            throw new Error("Executable does not export main");
        }

        const argc = argv.length;
        const argvPtr = allocateArgv(env, argv);

        const status = await exports.main(argc, argvPtr);

        return Number(status) || 0;
    } catch (e) {
        if (e instanceof ProcessExit) {
            return e.status
        }
        throw e;
    } finally {
        if (env.thread) {
            const ids = [
                ...env.instanceid,
                ...env.dlinstanceid.values()
            ];

            await Promise.allSettled(
                ids.map(id => env.thread.close(id))
            );

            await Promise.allSettled(
                env.fd.handles.map(fd => fd?.close(env))
            );

            env.thread.terminate();
        }
    }
}

(async () => {
    await FS.ready;
    await run_from_path(await TTY.env.find("PATH", "main"), {
        env: TTY.env.cloneVars(),
        stdout: TTY.stdout,
    })
})()

