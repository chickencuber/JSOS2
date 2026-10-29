class NullDevice {
    read() {
        return new Uint8Array(0);
    }

    write(contents) {
        return contents.length;
    }
}
