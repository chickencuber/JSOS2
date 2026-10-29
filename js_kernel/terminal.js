const TTY = new (class {
    env = new Env;
    terminal = $("#terminal");

    cols = 80;
    rows = 25;

    #cursorX = 0;
    #cursorY = 0;

    get cursorX() {
        return this.#cursorX;
    }

    get cursorY() {
        return this.#cursorY;
    }

    set cursorX(v) {
        this.#cursorX = Math.max(0, Math.min(this.cols - 1, v));
    }

    set cursorY(v) {
        this.#cursorY = Math.max(0, Math.min(this.rows - 1, v));
    }

    screen = [];

    escapeState = 0;
    escapeBuffer = "";

    constructor() {
        this.env.vars = new Map([
            ["LIBPATH", "/lib;/usr/lib;"],
            ["PATH", "/bin;/usr/bin;"]
        ]);
        this.resize();

        const stdout = Descriptor.virtual(this.env);
        this.stdout = Descriptor.get(this.env, stdout);

        this.render();

        window.addEventListener("resize", () => this.resize());

        this.main();
    }

    resize() {
        // Use the actual DOM element, not the result of $("#terminal").
        const el = document.getElementById("terminal");

        if (!el) {
            console.error("TTY: #terminal element not found");
            return;
        }

        const style = getComputedStyle(el);

        const paddingX =
            parseFloat(style.paddingLeft) +
            parseFloat(style.paddingRight);

        const paddingY =
            parseFloat(style.paddingTop) +
            parseFloat(style.paddingBottom);

        // Measure the width of one monospace character.
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        context.font = style.font;

        const charWidth = context.measureText("M").width;
        const lineHeight = parseFloat(style.lineHeight);

        if (
            !charWidth ||
            !Number.isFinite(lineHeight) ||
            lineHeight <= 0
        ) {
            console.error(
                "TTY: Could not determine character dimensions. " +
                "Set an explicit line-height on #terminal."
            );
            return;
        }

        const width = el.clientWidth - paddingX;
        const height = el.clientHeight - paddingY;

        const cols = Math.max(1, Math.floor(width / charWidth));
        const rows = Math.max(1, Math.floor(height / lineHeight));

        if (cols === this.cols && rows === this.rows && this.screen.length) {
            return;
        }

        const oldScreen = this.screen;
        const screen = Array.from(
            { length: rows },
            (_, y) => {
                const row = Array(cols).fill(" ");

                if (oldScreen[y]) {
                    for (let x = 0; x < Math.min(cols, oldScreen[y].length); x++) {
                        row[x] = oldScreen[y][x];
                    }
                }

                return row;
            }
        );

        this.cols = cols;
        this.rows = rows;
        this.screen = screen;

        this.cursorX = this.#cursorX;
        this.cursorY = this.#cursorY;

        this.render();
        this.renderCursor();
    }

    clearScreen(mode = 0) {
        if (mode === 2 || mode === 3) {
            this.screen = Array.from(
                { length: this.rows },
                () => Array(this.cols).fill(" ")
            );
        } else if (mode === 0) {
            for (let y = this.cursorY; y < this.rows; y++) {
                const start = y === this.cursorY ? this.cursorX : 0;
                this.screen[y].fill(" ", start);
            }
        } else if (mode === 1) {
            for (let y = 0; y <= this.cursorY; y++) {
                const end = y === this.cursorY ? this.cursorX + 1 : this.cols;
                this.screen[y].fill(" ", 0, end);
            }
        }
    }

    clearLine(mode = 0) {
        const row = this.screen[this.cursorY];

        if (mode === 0) {
            row.fill(" ", this.cursorX);
        } else if (mode === 1) {
            row.fill(" ", 0, this.cursorX + 1);
        } else if (mode === 2) {
            row.fill(" ");
        }
    }

    handleCSI(sequence) {
        const final = sequence.at(-1);
        const rawParams = sequence.slice(0, -1);
        const privateMode = rawParams.startsWith("?");

        const params = rawParams
            .replace(/^[?>!]/, "")
            .split(";")
            .map(value => value === "" ? 0 : Number(value));

        const n = params[0] || 1;

        switch (final) {
            case "A":
                this.cursorY -= n;
                break;
            case "B":
                this.cursorY += n;
                break;
            case "C":
                this.cursorX += n;
                break;
            case "D":
                this.cursorX -= n;
                break;
            case "E":
                this.cursorY += n;
                this.cursorX = 0;
                break;
            case "F":
                this.cursorY -= n;
                this.cursorX = 0;
                break;
            case "G":
            case "`":
                this.cursorX = n - 1;
                break;
            case "d":
                this.cursorY = n - 1;
                break;
            case "H":
            case "f":
                this.cursorY = (params[0] || 1) - 1;
                this.cursorX = (params[1] || 1) - 1;
                break;
            case "J":
                this.clearScreen(params[0] || 0);
                break;
            case "K":
                this.clearLine(params[0] || 0);
                break;
            case "s":
                this.savedCursor = [this.cursorX, this.cursorY];
                break;
            case "u":
                if (this.savedCursor) {
                    [this.cursorX, this.cursorY] = this.savedCursor;
                }
                break;
            case "m":
                // SGR styling is not implemented yet.
                break;
            case "h":
            case "l":
                // Terminal modes are not implemented yet.
                if (privateMode) break;
                break;
        }
    }

    writeChar(char) {
        const code = char.charCodeAt(0);

        if (this.escapeState === 0 && code === 0x1b) {
            this.escapeState = 1;
            this.escapeBuffer = "";
            return;
        }

        if (this.escapeState === 1) {
            if (char === "[") {
                this.escapeState = 2;
                this.escapeBuffer = "";
            } else if (char === "]") {
                this.escapeState = 3;
                this.escapeBuffer = "";
            } else {
                this.escapeState = 0;
            }
            return;
        }

        if (this.escapeState === 2) {
            this.escapeBuffer += char;

            if (code >= 0x40 && code <= 0x7e) {
                this.handleCSI(this.escapeBuffer);
                this.escapeState = 0;
                this.escapeBuffer = "";
            } else if (this.escapeBuffer.length > 128) {
                this.escapeState = 0;
                this.escapeBuffer = "";
            }
            return;
        }

        if (this.escapeState === 3) {
            if (code === 0x07) {
                this.escapeState = 0;
                this.escapeBuffer = "";
            } else if (code === 0x1b) {
                this.escapeState = 4;
            } else {
                this.escapeBuffer += char;
            }
            return;
        }

        if (this.escapeState === 4) {
            this.escapeState = char === "\\" ? 0 : 3;
            this.escapeBuffer = "";
            return;
        }

        if (char === "\n") {
            this.cursorX = 0;
            this.cursorY++;
        } else if (char === "\r") {
            this.cursorX = 0;
        } else if (char === "\b") {
            this.cursorX = Math.max(0, this.cursorX - 1);
        } else if (char === "\t") {
            this.cursorX = Math.min(
                this.cols - 1,
                (Math.floor(this.cursorX / 8) + 1) * 8
            );
        } else if (code >= 0x20 && code !== 0x7f) {
            this.screen[this.cursorY][this.cursorX] = char;

            if (this.cursorX === this.cols - 1) {
                this.cursorX = 0;
                this.cursorY++;
            } else {
                this.cursorX++;
            }
        }

        if (this.cursorY >= this.rows) {
            this.screen.shift();
            this.screen.push(Array(this.cols).fill(" "));
            this.cursorY = this.rows - 1;
        }
    }

    renderCursor() {
        const cursor = $("#cursor");

        cursor.css({
            left: `${this.cursorX}ch`,
            top: `calc(${this.cursorY} * (1em + var(--line-spacing)))`
        });

        cursor.text(this.screen[this.cursorY]?.[this.cursorX] || " ");
    }

    render() {
        this.terminal.text(
            this.screen.map(row => row.join("")).join("\n")
        );
    }

    main() {
        const b = this.stdout.read(1);

        for (let i = 0; i < b.length; i++) {
            this.writeChar(String.fromCharCode(b[i]));
        }

        if (b.length) {
            this.render();
        }

        this.renderCursor();
        requestAnimationFrame(this.main.bind(this));
    }
});
