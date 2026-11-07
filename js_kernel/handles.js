const O_RDONLY = 0x0000;
const O_WRONLY = 0x0001;
const O_RDWR = 0x0002;
const O_ACCMODE = 0x0003;

const O_CREAT = 0x0100;
const O_EXCL = 0x0200;
const O_TRUNC = 0x0400;
const O_APPEND = 0x0800;

const OPEN_FLAGS =
    O_ACCMODE | O_CREAT | O_EXCL | O_TRUNC | O_APPEND;

class RingBuffer {
    constructor(cap = 4096) {
        if (!Number.isInteger(cap) || cap <= 0)
            throw new RangeError("Capacity must be a positive integer");

        this.cap = cap;
        this.arr = new Array(cap).fill(null);
        this.head = 0;
        this.length = 0;

        return new Proxy(this, {
            get(target, prop, receiver) {
                if (typeof prop === "string" && /^-?\d+$/.test(prop))
                    return target.at(Number(prop));
                return Reflect.get(target, prop, receiver);
            },

            set(target, prop, value, receiver) {
                if (typeof prop === "string" && /^-?\d+$/.test(prop)) {
                    const i = Number(prop);
                    if (i < 0 || i >= target.length) return false;
                    target.arr[target.index(target.head + i)] = value;
                    return true;
                }
                return Reflect.set(target, prop, value, receiver);
            }
        });
    }

    index(i) {
        return ((i % this.cap) + this.cap) % this.cap;
    }

    at(i) {
        if (i < 0) i += this.length;
        if (i < 0 || i >= this.length) return undefined;
        return this.arr[this.index(this.head + i)];
    }

    push(...items) {
        for (const item of items) {
            if (this.length < this.cap) {
                this.arr[this.index(this.head + this.length)] = item;
                this.length++;
            } else {
                this.arr[this.head] = item;
                this.head = this.index(this.head + 1);
            }
        }
        return this.length;
    }

    pop() {
        if (!this.length) return undefined;
        const i = this.index(this.head + this.length - 1);
        const item = this.arr[i];
        this.arr[i] = null;
        this.length--;
        return item;
    }

    shift() {
        if (!this.length) return undefined;
        const item = this.arr[this.head];
        this.arr[this.head] = null;
        this.head = this.index(this.head + 1);
        this.length--;
        return item;
    }

    unshift(...items) {
        for (let i = items.length - 1; i >= 0; i--) {
            this.head = this.index(this.head - 1);
            this.arr[this.head] = items[i];
            if (this.length < this.cap) this.length++;
        }
        return this.length;
    }

    slice(start = 0, end = this.length) {
        start = start < 0
            ? Math.max(this.length + start, 0)
            : Math.min(start, this.length);

        end = end < 0
            ? Math.max(this.length + end, 0)
            : Math.min(end, this.length);

        const result = [];
        for (let i = start; i < end; i++)
            result.push(this.at(i));

        return result;
    }

    filter(callback, thisArg) {
        return this.toArray().filter(callback, thisArg);
    }

    toArray() {
        return this.slice();
    }

    clear() {
        this.arr.fill(null);
        this.head = 0;
        this.length = 0;
    }
}

class OpenFile {
    static #inodes = new Map();

    inode;
    data;
    device = null;
    openRefs = 0;
    dirty = false;
    version = 0;
    promise = null;
    fake = false;

    constructor(id, inode, fake = false) {
        this.inode = id;
        this.data = inode;
        this.fake = fake;
    }

    static openDevice(device) {
        const inode = {
            type: "file",
            created: 0,
            modified: 0,
            perms: 0o666,
            owner: "root",
            group: "root",
            contents: [],
        };

        const file = new OpenFile(crypto.randomUUID(), inode, true);
        file.device = device;
        return file;
    }

    async flush() {
        if (this.fake || !this.dirty) return;

        const version = this.version;
        await FS.set_inode(this.inode, this.data);

        if (this.version === version)
            this.dirty = false;
    }

    async release() {
        if (this.openRefs <= 0) return;

        this.openRefs--;

        if (this.openRefs === 0) {
            await this.flush();

            if (this.device)
                await this.device.close?.();

            if (!this.fake)
                await FS.release_inode(this.inode);

            if (OpenFile.#inodes.get(this.inode) === this)
                OpenFile.#inodes.delete(this.inode);
        }
    }

    markDirty() {
        this.dirty = true;
        this.version++;
    }

    retain() {
        this.openRefs++;
    }

    static async open(path) {
        const id = await FS.resolve(path);
        if (id === null) throw new Error("ENOENT");

        let file = this.#inodes.get(id);

        if (!file) {
            file = new OpenFile(id, null);

            file.promise = FS.get_inode(id)
                .then(inode => {
                    if (!inode) throw new Error("ENOENT");
                    file.data = inode;
                    file.promise = null;
                    return file;
                })
                .catch(error => {
                    if (this.#inodes.get(id) === file)
                        this.#inodes.delete(id);
                    throw error;
                });

            this.#inodes.set(id, file);
        }

        if (file.promise)
            await file.promise;

        if (typeof FS.retain_inode === "function") {
            const result = await FS.retain_inode(id);
            if (result !== 0) throw new Error("ENOENT");
        }

        file.retain();
        return file;
    }
}

class Descriptor {
    openFile;
    offset = 0;
    flags;
    fd;
    closed = false;
    dirState = null;

    constructor(env, openFile, [
        fd = null,
        onConflict = "continue",
    ] = [], flags = 0) {
        this.openFile = openFile;
        this.flags = flags;

        if (fd !== null) {
            while (env.fd.handles.length <= fd) {
                env.fd.free.push(env.fd.handles.length);
                env.fd.handles.push(null);
            }

            const existing = env.fd.handles[fd];

            if (existing && onConflict === "ignore") {
                this.openFile = null;
                this.closed = true;
                return;
            }

            if (existing && onConflict === "fail")
                throw new Error("EBUSY");

            if (existing && onConflict === "replace") {
                void existing.close(env);
            }

            if (!existing || onConflict === "replace") {
                this.fd = fd;
                env.fd.handles[fd] = this;
                return;
            }
        }

        if (env.fd.free.length > 0) {
            this.fd = env.fd.free.pop();
            env.fd.handles[this.fd] = this;
        } else {
            this.fd = env.fd.handles.length;
            env.fd.handles.push(this);
        }
    }

    get data() {
        return this.openFile?.data ?? null;
    }

    read(count) {
        if (this.closed) throw new Error("EBADF");
        if ((this.flags & O_ACCMODE) === O_WRONLY)
            throw new Error("EBADF");

        count = Math.max(0, Math.trunc(count));

        if (this.openFile.device) {
            const result = this.openFile.device.read(count);
            if (result instanceof Uint8Array) return result;
            return new Uint8Array(result);
        }

        const data = this.data;
        if (data.type === "dir") throw new Error("EISDIR");

        const contents = data.contents;
        const start = this.offset;
        const end = Math.min(start + count, contents.length);

        this.offset = end;

        return new Uint8Array(contents.slice(start, end));
    }

    write(contents) {
        if (this.closed) throw new Error("EBADF");
        if ((this.flags & O_ACCMODE) === O_RDONLY)
            throw new Error("EBADF");

        const bytes = contents instanceof Uint8Array
            ? contents
            : new Uint8Array(contents);

        if (this.openFile.device)
            return this.openFile.device.write(bytes);

        const data = this.data;
        if (data.type === "dir") throw new Error("EISDIR");

        const target = data.contents;

        // Ring buffers are streams: writes append, and old data is
        // discarded automatically when the buffer reaches capacity.
        if (target instanceof RingBuffer) {
            target.push(...bytes);
            return bytes.length;
        }

        if (this.flags & O_APPEND)
            this.offset = target.length;

        const end = this.offset + bytes.length;

        while (target.length < end)
            target.push(0);

        for (let i = 0; i < bytes.length; i++)
            target[this.offset + i] = bytes[i];

        this.offset = end;
        data.modified = Date.now();
        this.openFile.markDirty();

        return bytes.length;
    }

    async flush() {
        if (this.closed) throw new Error("EBADF");
        await this.openFile.flush();
    }

    async close(env) {
        if (this.closed) return;

        this.closed = true;
        const i = this.fd;

        if (env.fd.handles[i] === this) {
            env.fd.handles[i] = null;
            env.fd.free.push(i);
        }

        await this.openFile.release();
    }

    dup(env, ensure = [], flags = this.flags) {
        if (this.closed) throw new Error("EBADF");

        this.openFile.retain();

        try {
            const d = new Descriptor(env, this.openFile, ensure, flags);
            d.offset = this.offset;
            d.dirState = this.dirState;
            return d.fd;
        } catch (error) {
            void this.openFile.release();
            throw error;
        }
    }

    static get(env, fd) {
        return env.fd.handles[fd] ?? null;
    }

    static async fromFile(env, path, ensure = [], flags = 0) {
        path = String(path);

        if (FS.is_device_path(path)) {
            const device = FS.open_device(path, env);
            if (!device) throw new Error("ENOENT");

            const openFile = OpenFile.openDevice(device);
            openFile.retain();

            try {
                const descriptor = new Descriptor(
                    env, openFile, ensure, flags
                );

                if (descriptor.closed)
                    await openFile.release();

                return descriptor.fd;
            } catch (error) {
                await openFile.release();
                throw error;
            }
        }

        const openFile = await OpenFile.open(path);

        try {
            return new Descriptor(env, openFile, ensure, flags).fd;
        } catch (error) {
            await openFile.release();
            throw error;
        }
    }

    static virtual(env, ensure = [], flags=0, cap = 4096) {
        const inode = {
            type: "file",
            created: 0,
            modified: 0,
            perms: 0o666,
            owner: "root",
            group: "root",
            contents: new RingBuffer(cap),
        };

        const openFile = new OpenFile(
            crypto.randomUUID(), inode, true
        );

        openFile.retain();
        return new Descriptor(env, openFile, ensure).fd;
    }

    static empty() {
        return {
            dup(env, ensure = [], flags = 0) {
                return Descriptor.virtual(env, ensure, flags);
            }
        };
    }
}

/**
 * @param {Env} env
 */
async function open(_, __, env, path, flags = 0, mode = 0o666) {
    path = readCString(env.mem, path);

    const access = flags & O_ACCMODE;

    if (access > O_RDWR || (flags & ~OPEN_FLAGS))
        return -1;

    try {
        if (FS.is_device_path(path)) {
            if (flags & (O_CREAT | O_EXCL | O_TRUNC))
                return -1;

            return await Descriptor.fromFile(env, path, [], flags);
        }

        let id = await FS.resolve(path);

        if (id !== null) {
            if ((flags & O_CREAT) && (flags & O_EXCL))
                return -1;
        } else {
            if (!(flags & O_CREAT))
                return -1;

            const result = await FS.write_all(
                path, [], { perms: mode & 0o777 }
            );

            if (result !== 0)
                return -1;

            id = await FS.resolve(path);
            if (id === null) return -1;
        }

        const inode = await FS.get_inode(id);
        if (!inode) return -1;

        if ((flags & O_TRUNC) &&
            (access === O_RDONLY || inode.type !== "file"))
            return -1;

        const fd = await Descriptor.fromFile(env, path, [], flags);

        if (flags & O_TRUNC) {
            const d = Descriptor.get(env, fd);
            d.openFile.data.contents = [];
            d.openFile.data.modified = Date.now();
            d.openFile.markDirty();
            d.offset = 0;
        }

        return fd;
    } catch {
        return -1;
    }
}
syscall(open);

async function close(_, _, env, fd) {
    const d = Descriptor.get(env, fd);
    if (!d) return -1;

    try {
        await d.close(env);
        return 0;
    } catch {
        return -1;
    }
}
syscall(close);

function write(_, _, env, fd, buf, size) {
    const d = Descriptor.get(env, fd);
    if (!d) return -1;

    try {
        if (!Number.isInteger(size) || size < 0)
            return -1;

        const buffer = readBytes(env.mem, buf, size);
        const result = d.write(buffer);

        return Number.isInteger(result) ? result : size;
    } catch {
        return -1;
    }
}
syscall(write);

function read(_, _, env, fd, buf, size) {
    const d = Descriptor.get(env, fd);
    if (!d) return -1;

    try {
        if (!Number.isInteger(size) || size < 0)
            return -1;

        const bytes = d.read(size);
        new Uint8Array(env.mem.buffer, buf, bytes.length).set(bytes);
        return bytes.length;
    } catch {
        return -1;
    }
}
syscall(read);

async function flush(_, _, env, fd) {
    const d = Descriptor.get(env, fd);
    if (!d) return -1;

    try {
        await d.flush();
        return 0;
    } catch {
        return -1;
    }
}
syscall(flush);

function seek(_, _, env, fd, offset, whence) {
    const d = Descriptor.get(env, fd);
    if (!d || d.closed) return -1;
    if (d.openFile.device || d.data.contents instanceof RingBuffer)
        return -1;

    let base;

    switch (whence) {
        case 0:
            base = 0;
            break;
        case 1:
            base = d.offset;
            break;
        case 2:
            if (d.data.type === "dir") return -1;
            base = d.data.contents.length;
            break;
        default:
            return -1;
    }

    const next = base + offset;
    if (!Number.isSafeInteger(next) || next < 0)
        return -1;

    d.offset = next;
    return next;
}
syscall(seek);

function readdir(_, _, env, fd, buf, size) {
    const d = Descriptor.get(env, fd);
    if (!d) return -1;

    try {
        if (!Number.isInteger(size) || size <= 0)
            return -1;

        const name = d.readdir(size);
        if (name === null) return 0;

        const bytes = new TextEncoder().encode(name);
        const target = new Uint8Array(env.mem.buffer, buf, size);

        target.fill(0);
        target.set(bytes);

        return bytes.length;
    } catch {
        return -1;
    }
}
syscall(readdir);

async function mkdir(_, _, env, path, mode) {
    path = readCString(env.mem, path);

    try {
        return await FS.mkdir(path, {
            perms: mode & 0o777,
        }) === 0 ? 0 : -1;
    } catch {
        return -1;
    }
}
syscall(mkdir);

async function rmdir(_, _, env, path) {
    path = readCString(env.mem, path);

    try {
        const id = await FS.resolve(path);
        if (id === null || id === 0) return -1;

        const inode = await FS.get_inode(id);
        if (!inode || inode.type !== "dir") return -1;

        return await FS.remove(path) === 0 ? 0 : -1;
    } catch {
        return -1;
    }
}
syscall(rmdir);
