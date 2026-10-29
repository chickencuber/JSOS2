class RingBuffer {
    constructor(cap = 4096) {
        if (!Number.isInteger(cap) || cap <= 0) {
            throw new RangeError("Capacity must be a positive integer");
        }

        this.cap = cap;
        this.arr = new Array(cap).fill(null);
        this.head = 0;
        this.length = 0;

        return new Proxy(this, {
            get(target, prop, receiver) {
                if (typeof prop === "string" && /^-?\d+$/.test(prop)) {
                    return target.at(Number(prop));
                }
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
        if (this.length === 0) return undefined;

        const i = this.index(this.head + this.length - 1);
        const item = this.arr[i];

        this.arr[i] = null;
        this.length--;

        return item;
    }

    shift() {
        if (this.length === 0) return undefined;

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

            if (this.length < this.cap) {
                this.length++;
            }
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
        for (let i = start; i < end; i++) {
            result.push(this.at(i));
        }
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

    /**
     * Create a new, independent device-backed OpenFile.
     * Device OpenFiles always have UUID identities.
     */
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

        const file = new OpenFile(
            crypto.randomUUID(),
            inode,
            true
        );

        file.device = device;
        return file;
    }

    async flush() {
        if (this.fake || !this.dirty) return;

        const version = this.version;
        await FS.set_inode(this.inode, this.data);

        if (this.version === version) {
            this.dirty = false;
        }
    }

    async release() {
        if (this.openRefs <= 0) return;

        this.openRefs--;

        if (this.openRefs === 0) {
            await this.flush();

            if (this.device) {
                this.device.close?.();
            }

            if (!this.fake) {
                await FS.release_inode(this.inode);
            }

            if (OpenFile.#inodes.get(this.inode) === this) {
                OpenFile.#inodes.delete(this.inode);
            }
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
                    if (this.#inodes.get(id) === file) {
                        this.#inodes.delete(id);
                    }
                    throw error;
                });

            this.#inodes.set(id, file);
        }

        if (file.promise) {
            await file.promise;
        }

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

            if (existing && onConflict === "fail") {
                throw new Error("EBUSY");
            }

            if (existing && onConflict === "replace") {
                existing.close(env);
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

        count = Math.max(0, Math.trunc(count));

        if (this.openFile.device) {
            const result = this.openFile.device.read(count);

            if (result instanceof Uint8Array) return result;
            return new Uint8Array(result);
        }

        const data = this.data;
        if (data.type === "dir") throw new Error("EISDIR");

        const start = this.offset;
        const end = Math.min(start + count, data.contents.length);

        this.offset = end;

        return new Uint8Array(data.contents.slice(start, end));
    }

    write(contents) {
        if (this.closed) throw new Error("EBADF");

        const bytes = contents instanceof Uint8Array
            ? contents
            : new Uint8Array(contents);

        if (this.openFile.device) {
            return this.openFile.device.write(bytes);
        }

        const data = this.data;
        if (data.type === "dir") throw new Error("EISDIR");

        const contentsArray = data.contents;

        while (contentsArray.length < this.offset + bytes.length) {
            contentsArray.push(0);
        }

        for (let i = 0; i < bytes.length; i++) {
            contentsArray[this.offset + i] = bytes[i];
        }

        this.offset += bytes.length;
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

    dup(env, ensure = []) {
        if (this.closed) throw new Error("EBADF");

        this.openFile.retain();

        try {
            const d = new Descriptor(env, this.openFile, ensure);
            d.offset = this.offset;
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
                    env,
                    openFile,
                    ensure,
                    flags
                );

                if (descriptor.closed) {
                    await openFile.release();
                }

                return descriptor.fd;
            } catch (error) {
                await openFile.release();
                throw error;
            }
        }

        const openFile = await OpenFile.open(path);
        return new Descriptor(env, openFile, ensure, flags).fd;
    }

    static virtual(env, ensure = [], cap = 4096) {
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
            crypto.randomUUID(),
            inode,
            true
        );

        openFile.retain();
        return new Descriptor(env, openFile, ensure).fd;
    }

    static empty() {
        return {
            dup(env, ensure = []) {
                return Descriptor.virtual(env, ensure);
            }
        };
    }
}

/**
 * @param {Env} env
 */
async function open(_, _, env, path) {
    path = readCString(env.mem, path);

    try {
        return await Descriptor.fromFile(env, path);
    } catch {
        return -1;
    }
}
syscall(open);

async function close(_, _, env, fd) {
    const d = Descriptor.get(env, fd);
    await d?.close(env);
}
syscall(close);

function write(_, _, env, fd, buf, size) {
    const d = Descriptor.get(env, fd);
    if (!d) return -1;

    try {
        const buffer = readBytes(env.mem, buf, size);
        return d.write(buffer);
    } catch {
        return -1;
    }
}
syscall(write);

function read(_, _, env, fd, buf, size) {
    const d = Descriptor.get(env, fd);
    if (!d) return -1;

    try {
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
        return 1;
    } catch {
        return -1;
    }
}
syscall(flush);

function seek(_, _, env, fd, offset, whence) {
    const d = Descriptor.get(env, fd);
    if (!d) return -1;

    // Devices are streams, not seekable files.
    if (d.openFile.device) return -1;

    let base;

    switch (whence) {
        case 0: // SEEK_SET
            base = 0;
            break;
        case 1: // SEEK_CUR
            base = d.offset;
            break;
        case 2: // SEEK_END
            base = d.data.contents.length;
            break;
        default:
            return -1;
    }

    const next = base + offset;
    if (next < 0) return -1;

    d.offset = next;
    return next;
}
syscall(seek);
