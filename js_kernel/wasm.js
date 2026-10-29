class Thread {
    constructor(worker) {
        this.worker = worker;
        this.nextId = 0;
        this.nextInstanceId = 0;
        this.pending = new Map();
        this.imports = new Map();

        worker.addEventListener("message", ({ data }) => {
            if (data.type === "import-call") {
                this.handleImport(data);
                return;
            }

            const task = this.pending.get(data.id);
            if (!task) return;

            this.pending.delete(data.id);

            if (data.error) {
                task.reject(new Error(data.error));
            } else {
                task.resolve(data.result);
            }
        });

        worker.addEventListener("error", event => {
            const error = event.error ??
                new Error(event.message || "Worker failed");

            for (const task of this.pending.values()) {
                task.reject(error);
            }

            this.pending.clear();
        });
    }

    request(type, data = {}) {
        const id = this.nextId++;

        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });

            try {
                this.worker.postMessage({ id, type, ...data });
            } catch (error) {
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    async handleImport(data) {
        try {
            const fn = this.imports.get(data.instanceId)
                ?.[data.module]?.[data.name];

            if (typeof fn !== "function") {
                throw new Error(
                    `Missing import '${data.module}:${data.name}'`
                );
            }

            const result = await fn(...data.args);

            this.worker.postMessage({
                type: "import-result",
                id: data.id,
                result,
            });
        } catch (error) {
            this.worker.postMessage({
                type: "import-result",
                id: data.id,
                error: String(error?.message ?? error),
            });
        }
    }

    async compile(buffer) {
        return this.request("compile", { buffer });
    }

    // Creates a real WebAssembly.Global inside this worker.
    // Returns a serializable handle to that global.
    async Global(descriptor, value) {
        return this.request("create-global", {
            descriptor,
            value,
        });
    }

    // Creates a reusable factory for a particular thread.
    static Global(descriptor, value) {
        return thread => thread.Global(descriptor, value);
    }

    async instantiate(module, imports = {}) {
        const instanceId = this.nextInstanceId++;
        this.imports.set(instanceId, imports);

        const values = {};

        try {
            for (const { module: mod, name, kind } of
                WebAssembly.Module.imports(module)) {

                if (kind === "function") continue;

                // The worker creates and owns this table.
                if (
                    kind === "table" &&
                    name === "__indirect_function_table"
                ) {
                    continue;
                }

                const value = imports[mod]?.[name];

                if (value === undefined) {
                    throw new Error(
                        `Missing import '${mod}:${name}'`
                    );
                }

                values[mod] ??= {};

                if (kind === "memory") {
                    if (!(value instanceof WebAssembly.Memory)) {
                        throw new TypeError(
                            `'${mod}:${name}' must be WebAssembly.Memory`
                        );
                    }

                    if (
                        typeof SharedArrayBuffer === "undefined" ||
                        !(value.buffer instanceof SharedArrayBuffer)
                    ) {
                        throw new TypeError(
                            `'${mod}:${name}' must use shared memory`
                        );
                    }

                    // Shared WebAssembly.Memory is passed directly.
                    // Do not try to reconstruct it from its buffer.
                    values[mod][name] = value;
                } else {
                    // Global handles are plain objects and can be cloned.
                    // The worker resolves them to real WebAssembly.Global
                    // objects during instantiation.
                    values[mod][name] = value;
                }
            }

            const result = await this.request("instantiate", {
                module,
                instanceId,
                values,
            });

            const exports = {};

            for (const descriptor of result.exports) {
                if (descriptor.kind === "function") {
                    exports[descriptor.name] = (...args) =>
                        this.request("call", {
                            instanceId,
                            name: descriptor.name,
                            args,
                        });
                }
            }

            return { exports, instanceId };
        } catch (error) {
            this.imports.delete(instanceId);
            throw error;
        }
    }

    async close(instanceId) {
        await this.request("close", { instanceId });
        this.imports.delete(instanceId);
    }

    terminate() {
        this.worker.terminate();

        for (const task of this.pending.values()) {
            task.reject(new Error("Worker terminated"));
        }

        this.pending.clear();
        this.imports.clear();
    }
}

function create_thread() {
    return new Thread(
        new Worker("./js_kernel/worker.js")
    );
};
