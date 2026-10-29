const { del, get, keys, set, clear } = idbKeyval;

const devices = {
    kb: env => new KeyboardDevice(env),
    null: env => new Null(env),
};

class PathBuf extends Array {
    /**
     * @param {string} string
     */
    static parse(string) {
        const v = new PathBuf();
        v.push(string);
        return v;
    }

    /**
     * @param {string} v
     */
        push(v) {
            if (v.includes("/")) {
                const s = v.split("/");
                for (const part of s) {
                    if (part === "") {
                        if (v.startsWith("/")) {
                            while (this.length > 0) this.pop();
                        }
                    } else {
                        this.push(part);
                    }
                }
                return;
            }

            if (v === ".") {
                return;
    } else if (v === "..") {
        this.pop();
    } else {
        super.push(v);
    }
}

    toString() {
        return "/" + this.join("/");
    }

    clone() {
        return PathBuf.parse(this.toString());
    }
}

const FS = new (class {
    #open_refs = new Map();
    #device_instances = new WeakMap();

    /**
     * @param {string | PathBuf} path
     */
    #path(path) {
        return typeof path === "string"
            ? PathBuf.parse(path)
            : path.clone();
    }

    /**
     * Check whether a path belongs to the device namespace.
     * @param {string | PathBuf} path
     */
    is_device_path(path) {
        path = this.#path(path);
        return path[0] === "dev";
    }

    /**
     * Get the device name from a path.
     * @param {string | PathBuf} path
     */
    #device_name(path) {
        path = this.#path(path);

        if (path[0] !== "dev") return null;
        if (path.length !== 2) return null;

        return path[1];
    }

    /**
     * Create a device instance.
     * Each call creates a new instance.
     * @param {string | PathBuf} path
     * @param {Env} env
     */
    open_device(path, env) {
        const name = this.#device_name(path);
        if (name === null) return null;

        if (!Object.hasOwn(devices, name)) {
            return null;
        }

        return devices[name](env);
    }

    /**
     * Resolve a path to an inode ID.
     * Returns null if the path does not exist.
     * Device paths are not regular inodes.
     * @param {PathBuf | string} path
     */
    async resolve(path) {
        path = this.#path(path);

        if (this.is_device_path(path)) return null;

        let id = 0;
        let inode = await this.#inode(id);

        if (!inode) return null;

        for (const p of path) {
            if (inode.type !== "dir") return null;

            id = inode.children[p];
            if (id === undefined) return null;

            inode = await this.#inode(id);
            if (!inode) return null;
        }

        return id;
    }

    /**
     * @param {number} id
     */
    async #inode(id) {
        return await get("inode:" + id);
    }

    /**
     * Allocate a new inode ID.
     * IDs are never reused.
     * @param {INode} data
     */
    async #push_inode(data) {
        const id = await get("fs:next_inode") ?? 0;

        await set("fs:next_inode", id + 1);
        await set("inode:" + id, data);

        return id;
    }

    /**
     * Read directly from an inode.
     * @param {number} id
     */
    async read_inode(id) {
        const inode = await this.#inode(id);

        if (!inode || inode.type !== "file") return null;

        return inode.contents;
    }

    /**
     * Write directly to an existing inode.
     * @param {number} id
     * @param {number[]} contents
     */
    async write_inode(id, contents) {
        const inode = await this.#inode(id);

        if (!inode || inode.type !== "file") return 1;

        inode.contents = contents;
        inode.modified = Date.now();

        await set("inode:" + id, inode);
        return 0;
    }

    /**
     * Keep an inode alive while a descriptor references it.
     * @param {number} id
     */
    async retain_inode(id) {
        if (!await this.#inode(id)) return 1;

        this.#open_refs.set(
            id,
            (this.#open_refs.get(id) ?? 0) + 1
        );

        return 0;
    }

    /**
     * Release an inode reference.
     * @param {number} id
     */
    async release_inode(id) {
        const refs = this.#open_refs.get(id) ?? 0;
        if (refs === 0) return 1;

        if (refs > 1) {
            this.#open_refs.set(id, refs - 1);
            return 0;
        }

        this.#open_refs.delete(id);

        const inode = await this.#inode(id);

        if (inode?.unlinked) {
            await del("inode:" + id);
        }

        return 0;
    }

    get open_refs() {
        return this.#open_refs;
    }

    async get_inode(id) {
        return await get(`inode:${id}`);
    }

    async set_inode(id, inode) {
        await set(`inode:${id}`, inode);
    }

    ready;

    constructor() {
        this.ready = this.#init();
    }

    async #init() {
        if (await get("inode:0") !== undefined) {
            // return
        }

        await clear();

        /**
         * @type {JSONNode & {type: "dir"}}
         */
        const conf = await (await fetch("fs.json", {
            cache: "no-store",
        })).json();

        await this.#push_inode({
            type: "dir",
            children: {},
            created: Date.now(),
            modified: Date.now(),
            perms: conf.mode,
            owner: conf.owner,
            group: conf.group,
        });

        const fn =
            /**
             * @param {PathBuf} path
             * @param {JSONNode & {type: "dir"}} conf_part
             */
            async (path, conf_part) => {
                for (const [name, child] of Object.entries(
                    conf_part.children ?? {}
                )) {
                    const p = path.clone();

                    const opt = {
                        perms: child.mode,
                        owner: child.owner,
                        group: child.group,
                    };

                    p.push(name);

                    if (child.type === "dir") {
                        await this.mkdir(p, opt);
                        await fn(p, child);
                    } else if (child.type === "file") {
                        let bytes;

                        if (child.include) {
                            bytes = Array.from(
                                new Uint8Array(
                                    await (
                                        await fetch(child.include, {
                                            cache: "no-store",
                                        })
                                    ).arrayBuffer()
                                )
                            );
                        } else {
                            bytes = Array.from(
                                new TextEncoder().encode(
                                    child.content ?? ""
                                )
                            );
                        }

                        await this.write_all(p, bytes, opt);
                    }
                }
            };

        await fn(new PathBuf(), conf);
    }

    /**
     * Create a file, or replace the contents of an existing file.
     * @param {PathBuf | string} path
     * @param {number[]} contents
     */
    async write_all(
        path,
        contents,
        { perms = 0o755, owner = "root", group = "root" } = {}
    ) {
        path = this.#path(path);

        if (this.is_device_path(path)) return 1;

        const name = path.pop();
        if (name === undefined) return 1;

        const parent_id = await this.resolve(path);
        if (parent_id === null) return 1;

        const parent = await this.#inode(parent_id);
        if (!parent || parent.type !== "dir") return 1;

        const child_id = parent.children[name];

        if (child_id !== undefined) {
            const child = await this.#inode(child_id);

            if (!child || child.type !== "file") return 1;

            return await this.write_inode(child_id, contents);
        }

        const now = Date.now();

        const id = await this.#push_inode({
            type: "file",
            contents,
            created: now,
            modified: now,
            perms,
            owner,
            group,
        });

        parent.children[name] = id;
        parent.modified = now;

        await set("inode:" + parent_id, parent);

        return 0;
    }

    /**
     * Create a directory.
     * @param {PathBuf | string} path
     */
    async mkdir(
        path,
        { perms = 0o755, owner = "root", group = "root" } = {}
    ) {
        path = this.#path(path);

        if (this.is_device_path(path)) return 1;

        const name = path.pop();
        if (name === undefined) return 1;

        const parent_id = await this.resolve(path);
        if (parent_id === null) return 1;

        const parent = await this.#inode(parent_id);
        if (!parent || parent.type !== "dir") return 1;

        if (parent.children[name] !== undefined) return 1;

        const now = Date.now();

        const id = await this.#push_inode({
            type: "dir",
            children: {},
            created: now,
            modified: now,
            perms,
            owner,
            group,
        });

        parent.children[name] = id;
        parent.modified = now;

        await set("inode:" + parent_id, parent);

        return 0;
    }

    /**
     * Read a file by path.
     * Device paths must be opened through open_device().
     * @param {PathBuf | string} path
     */
    async read(path) {
        if (this.is_device_path(path)) return null;

        const id = await this.resolve(path);
        if (id === null) return null;

        return await this.read_inode(id);
    }

    /**
     * Remove a file or an empty directory.
     * Open descriptors keep unlinked files alive.
     * @param {PathBuf | string} path
     */
    async remove(path) {
        path = this.#path(path);

        if (this.is_device_path(path)) return 1;

        const name = path.pop();
        if (name === undefined) return 1;

        const parent_id = await this.resolve(path);
        if (parent_id === null) return 1;

        const parent = await this.#inode(parent_id);
        if (!parent || parent.type !== "dir") return 1;

        const id = parent.children[name];
        if (id === undefined) return 1;

        const inode = await this.#inode(id);
        if (!inode) return 1;

        if (
            inode.type === "dir" &&
            Object.keys(inode.children).length !== 0
        ) {
            return 1;
        }

        delete parent.children[name];
        parent.modified = Date.now();

        await set("inode:" + parent_id, parent);

        if ((this.#open_refs.get(id) ?? 0) > 0) {
            inode.unlinked = true;
            await set("inode:" + id, inode);
        } else {
            await del("inode:" + id);
        }

        return 0;
    }
    /**
        * List the immediate children of a directory.
        * @param {PathBuf | string} path
        */
        async readdir(path) {
            const id = await this.resolve(path);
            if (id === null) return null;

            const inode = await this.#inode(id);
            if (!inode || inode.type !== "dir") return null;

            return Object.keys(inode.children);
        }
})();
