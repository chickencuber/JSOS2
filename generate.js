import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse } from "@chickencuber/cocl";
const args = process.argv;
args.shift();
args.shift();
//TASK(20260728-182213-987-n6-058): error handling
const input = args.shift();
const out = args.shift();
const output = {
    type: "dir",
    mode: 0o755,
    owner: "root",
    group: "root",
    children: {},
};
function touch(root, filePath, content) {
    const parts = filePath.split("/").filter(Boolean);
    const filename = parts.pop();
    if (!filename)
        throw new Error("invalid path");
    let current = root;
    for (const part of parts) {
        if (current.type !== "dir") {
            throw new Error(`${part} is not a directory`);
        }
        const next = current.children[part];
        if (!next) {
            throw new Error(`directory does not exist: ${part}`);
        }
        current = next;
    }
    if (current.type !== "dir") {
        throw new Error("parent is not a directory");
    }
    current.children[filename] = {
        type: "file",
        mode: 0o644,
        owner: "root",
        group: "root",
        content
    };
}
function mkdir(root, filePath) {
    const parts = filePath.split("/").filter(Boolean);
    const filename = parts.pop();
    if (!filename)
        throw new Error("invalid path");
    let current = root;
    for (const part of parts) {
        if (current.type !== "dir") {
            throw new Error(`${part} is not a directory`);
        }
        const next = current.children[part];
        if (!next) {
            throw new Error(`directory does not exist: ${part}`);
        }
        current = next;
    }
    if (current.type !== "dir") {
        throw new Error("parent is not a directory");
    }
    current.children[filename] = {
        type: "dir",
        mode: 0o755,
        owner: "root",
        group: "root",
        children: {},
    };
}
const _default = {
    wildcard: false,
    recursive: false,
    search: null,
};
const sets = {
    "*": {
        wildcard: true,
        recursive: false,
        search: null,
    },
    "**": {
        wildcard: true,
        recursive: true,
        search: null,
    },
    "*f": {
        wildcard: true,
        recursive: false,
        search: "file",
    },
    "**f": {
        wildcard: true,
        recursive: true,
        search: "file",
    },
    "*d": {
        wildcard: true,
        recursive: false,
        search: "dir",
    },
    "**d": {
        wildcard: true,
        recursive: true,
        search: "dir",
    },
};
function mod(root, { wildcard, recursive, search }, mode, owner, group, name) {
    if (wildcard) {
        for (const child of Object.values(root.children)) {
            if (search === null || search === child.type) {
                child.group = group;
                child.owner = owner;
                child.mode = mode;
            }
            if (child.type === "dir" && recursive) {
                mod(child, { wildcard, recursive, search }, mode, owner, group, name);
            }
        }
    }
    else {
        if (!root.children[name]) {
            throw new Error(`file ${name} doesn't exist`);
        }
        root.children[name].group = group;
        root.children[name].owner = owner;
        root.children[name].mode = mode;
    }
}
async function include(parent, host, name) {
    const stat = await fs.stat(host);
    if (stat.isDirectory()) {
        let dir = parent;
        if (name !== undefined) {
            dir = parent.children[name];
            if (dir) {
                if (dir.type !== "dir") {
                    throw new Error(`${name} already exists and is not a directory`);
                }
            }
            else {
                dir = {
                    type: "dir",
                    mode: 0o755,
                    owner: "root",
                    group: "root",
                    children: {},
                };
                parent.children[name] = dir;
            }
        }
        for (const child of await fs.readdir(host)) {
            await include(dir, path.join(host, child), child);
        }
    }
    else {
        parent.children[name] = {
            type: "file",
            mode: 0o644,
            owner: "root",
            group: "root",
            include: host
        };
    }
}
const commands = parse(await fs.readFile(input, "utf8"));
for (const command of commands) {
    switch (command.command) {
        case "touch":
            {
                const [to, content] = command.argv;
                touch(output, to, content);
            }
            break;
        case "mkdir":
            {
                const [to] = command.argv;
                mkdir(output, to);
            }
            break;
        case "mod":
            {
                const [to, owner, group, m] = command.argv;
                const parts = to.split("/").filter(Boolean);
                if (parts.length === 0) {
                    output.group = group;
                    output.owner = owner;
                    output.mode = parseInt(m, 8);
                    break;
                }
                let current = output;
                const tail = parts.pop();
                for (const part of parts) {
                    if (current.type !== "dir") {
                        throw new Error(`${part} is not a directory`);
                    }
                    const next = current.children[part];
                    if (!next) {
                        throw new Error(`directory does not exist: ${part}`);
                    }
                    current = next;
                }
                if (current.type !== "dir") {
                    throw new Error("parent is not a directory");
                }
                if (Object.hasOwn(sets, tail)) {
                    mod(current, sets[tail], parseInt(m, 8), owner, group);
                }
                else {
                    mod(current, _default, parseInt(m, 8), owner, group, tail);
                }
            }
            break;
        case "include": {
            const [host, target] = command.argv;
            const parts = target.split("/").filter(Boolean);
            let current = output;
            for (const part of parts.slice(0, -1)) {
                if (current.type !== "dir") {
                    throw new Error(`${part} is not a directory`);
                }
                const next = current.children[part];
                if (!next) {
                    throw new Error(`directory does not exist: ${part}`);
                }
                current = next;
            }
            if (current.type !== "dir") {
                throw new Error("parent is not a directory");
            }
            const tail = parts.at(-1);
            // "/" means merge the source directory into the root.
            await include(current, host, tail);
            break;
        }
        default:
            throw new Error(`unknown command '${command.command}'`);
    }
}
fs.writeFile(out, JSON.stringify(output, null, 4));
