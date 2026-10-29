/**
    * @type {((...args:any[])=>any)[]}
    */
const syscalls = [];


const global = {
    i32(thread, val, mut = false) {
        return thread.Global(
            { value: "i32", mutable: mut },
            val,
        )
    },
}

class Env {
    async find(varname, file) {
        if(!this.vars.has(varname)) return "";
        //I love javascripts new Iterator helpers
        const iter  = this.vars.get(varname).split(";").values().map(v=>v.trim()).filter(v => v!=="");
        for(const str of iter) {
            const children = await FS.readdir(str);
            if(children.includes(file)) {
                const p = PathBuf.parse(str);
                p.push(file);
                return p.toString();
            }
        }
        return "";
    }
    allocateTable(count, alignment) {
        this.nextTableSlot = (this.nextTableSlot + alignment - 1) & ~(alignment - 1);

        const base = this.nextTableSlot;
        this.nextTableSlot += count;

        return base;
    }
    allocate(size, alignment) {
        this.nextFree = (this.nextFree + alignment - 1) & ~(alignment - 1);
        const base = this.nextFree;
        this.nextFree += size;

        return base;
    }
    /**
        * @type {Thread}
        */
    thread;
    constructor() {
        this.mem = new WebAssembly.Memory({
            initial: 16,
            maximum: 256,
            shared: true,
        });

        this.dlinstanceid = new Map; 
        this.instanceid = []

        this.cwd = PathBuf.parse("/");
        /**
            * @type {Map<string, string>}
            */
        this.vars = new Map;
        this.fd = {
            handles: [],
            free: [],
        };

        this.user = "root";
        this.group = "root";
        this.handles = {};
        this.imported_libs = new Map;
        this.dlhandles = {};
        this.dlmem = {};
        this.nextFree = 0x10000;
        this.nextTableSlot = 0;

        const STACK_TOP = this.mem.buffer.byteLength - 16;
        this.stackPointer = Thread.Global(
            { value: "i32", mutable: true },
            STACK_TOP
        );
    }
    clone() {
        const env = new Env;
        env.vars = new Map(this.vars)
        env.user = this.user;
        env.cwd = this.cwd.clone();
        env.group = this.group;
        for (const [i, d] of this.fd.handles.entries()) {
            if (d) {
                d.dup(env, [i, "fail"]);
            }
        }
        return env;
    }
    cloneVars() {
        const env = new Env();
        env.vars = new Map(this.vars);
        return env;
    }
}

/**
    * @param {(...v: any[])=>any} fn 
    */
function syscall(fn) {
    if (fn?.name == null || fn?.name === "") {
        console.warn("function doesn't have name, skipping");
        return
    }
    syscalls.push(fn);
}

function readCString(memory, ptr) {
    const bytes = new Uint8Array(memory.buffer);

    let end = ptr;
    while (bytes[end] !== 0) {
        end++;
    }

    const copy = new Uint8Array(end - ptr);
    copy.set(bytes.subarray(ptr, end));

    return new TextDecoder().decode(copy);
}

function writeCString(memory, ptr, maxSize, string) {
    const bytes = new TextEncoder().encode(string);

    if (ptr === 0) return bytes.length + 1;

    const dest = new Uint8Array(memory.buffer);
    const size = Math.min(bytes.length, Math.max(0, maxSize - 1));

    dest.set(bytes.subarray(0, size), ptr);
    dest[ptr + size] = 0;

    return size + 1;
}

function readBytes(memory, ptr, size) {
    return new Uint8Array(memory.buffer, ptr, size);
}

function make_syscalls(id, filePath, env) {
    const obj = {};
    for (const syscall of syscalls) {
        obj[syscall.name] = syscall.bind(null, id, filePath, env);
    }
    return obj;
}

