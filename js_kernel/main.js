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
            const file = await (async() => {
                if(modname.startsWith("__file__:")) {
                    const path = PathBuf.parse(filePath);
                    path.pop();
                    path.push(modname.slice(9));
                    return path.toString();
                }
                return await env.find("LIBPATH", modname);
            })()
            if(env.imported_libs.has(file)) {
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
    const module = await thread.compile(buffer);
    const imports = WebAssembly.Module.imports(module);
    env.thread = thread;
    await resolve_imports(imports, env, filePath);
    env.handles.env.__memory_base = await global.i32(env.thread, 0);
    env.handles.env.__table_base = await global.i32(env.thread, 0);
    const instance = await thread.instantiate(module, env.handles);
    env.instanceid.push(instance.instanceId);
    return [instance.exports, env];
}

async function run_from_path(path, {stdin = Descriptor.empty(), stdout = Descriptor.empty(), stderr = Descriptor.empty(), env = new Env} = {}) {
    stdin.dup(env, [0, "ignore"]);
    stdout.dup(env, [1, "ignore"]);
    stderr.dup(env, [2, "ignore"]);
    const source = await FS.read(path);
    const buffer = new Uint8Array(source);
    const [exports] = await create_wasm(path, buffer, env);
    const main = exports.main;
    try {
        return await main();
    } catch (e) {
        console.error(e)
    } finally {
        await Promise.all(
            env.instanceid.map(id=>env.thread.close(id))
        )
        await Promise.all(
            env.dlinstanceid.values().map(id=>env.thread.close(id))
        )
        await Promise.all(
            env.fd.handles.map(fd =>fd?.close(env))
        );
        env.thread.terminate();
    }
}

(async () => {
    await FS.ready;
    await run_from_path(await TTY.env.find("PATH", "main"), {
        env: TTY.env.cloneVars(),
        stdout: TTY.stdout,
    })
})()

