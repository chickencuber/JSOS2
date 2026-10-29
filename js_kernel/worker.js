console.log("worker.js loaded");

const instances = new Map();
const pendingImports = new Map();
const globals = new Map();

// One table reused by modules in this worker.
const table = new WebAssembly.Table({
    initial: 256,
    element: "anyfunc",
});

let nextImportId = 1;
let nextGlobalId = 1;

function callImport(instanceId, module, name, args) {
    const id = nextImportId++;

    return new Promise((resolve, reject) => {
        pendingImports.set(id, { resolve, reject });

        self.postMessage({
            type: "import-call",
            id,
            instanceId,
            module,
            name,
            args,
        });
    });
}

function respond(id, result) {
    self.postMessage({ id, result });
}

function fail(id, error) {
    console.error("Worker request failed:", error);

    self.postMessage({
        id,
        error: String(error?.message ?? error),
    });
}

self.addEventListener("message", async ({ data }) => {
    const { id, type } = data;

    if (type === "import-result") {
        const task = pendingImports.get(id);
        if (!task) return;

        pendingImports.delete(id);

        if (data.error) {
            task.reject(new Error(data.error));
        } else {
            task.resolve(data.result);
        }

        return;
    }

    try {
        switch (type) {
            case "compile": {
                const module = await WebAssembly.compile(data.buffer);
                respond(id, module);
                break;
            }

            case "create-global": {
                const globalId = nextGlobalId++;

                const value = new WebAssembly.Global(
                    data.descriptor,
                    data.value
                );

                globals.set(globalId, value);

                // Only send the handle, never the actual Global.
                respond(id, {
                    __threadGlobal: globalId,
                });
                break;
            }

            case "instantiate": {
                const { module, instanceId, values = {} } = data;
                const imports = {};

                for (const descriptor of WebAssembly.Module.imports(module)) {
                    const { module: mod, name, kind } = descriptor;
                    imports[mod] ??= {};

                    if (kind === "function") {
                        if (typeof WebAssembly.Suspending !== "function") {
                            throw new Error(
                                "This browser does not support WebAssembly.Suspending"
                            );
                        }

                        imports[mod][name] = new WebAssembly.Suspending(
                            (...args) =>
                                callImport(instanceId, mod, name, args)
                        );

                        continue;
                    }

                    if (
                        kind === "table" &&
                        name === "__indirect_function_table"
                    ) {
                        imports[mod][name] = table;
                        continue;
                    }

                    const value = values[mod]?.[name];

                    if (value === undefined) {
                        throw new Error(`Missing import ${mod}:${name}`);
                    }

                    if (kind === "global" && value?.__threadGlobal !== undefined) {
                        const global = globals.get(value.__threadGlobal);

                        if (!global) {
                            throw new Error(
                                `Unknown worker global ${value.__threadGlobal}`
                            );
                        }

                        imports[mod][name] = global;
                    } else {
                        // Includes shared WebAssembly.Memory objects.
                        imports[mod][name] = value;
                    }
                }

                const instance = await WebAssembly.instantiate(
                    module,
                    imports
                );

                instances.set(instanceId, instance.exports);

                respond(id, {
                    instanceId,
                    exports: WebAssembly.Module.exports(module),
                });
                break;
            }

            case "call": {
                const exports = instances.get(data.instanceId);

                if (!exports) {
                    throw new Error(
                        `Unknown instance ${data.instanceId}`
                    );
                }

                const fn = exports[data.name];

                if (typeof fn !== "function") {
                    throw new Error(
                        `Export '${data.name}' is not a function`
                    );
                }

                if (typeof WebAssembly.promising !== "function") {
                    throw new Error(
                        "This browser does not support WebAssembly.promising"
                    );
                }

                const result = await WebAssembly.promising(fn)(
                    ...data.args
                );

                respond(id, result);
                break;
            }

            case "close": {
                instances.delete(data.instanceId);
                respond(id, true);
                break;
            }

            default:
                throw new Error(`Unknown request '${type}'`);
        }
    } catch (error) {
        fail(id, error);
    }
});

self.postMessage({ type: "worker-ready" });
