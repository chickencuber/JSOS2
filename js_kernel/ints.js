const {$} = JSQuery;

function i8(x) {
    return (x << 24) >> 24;
}
i8.bytes = 1;

function u8(x) {
    return x & 0xff;
}

u8.bytes = 1;

const byte = i8;
const ubyte = u8;

function i16(x) {
    return (x << 16) >> 16;
}

i16.bytes = 2;

function u16(x) {
    return x & 0xffff;
}

u16.bytes = 2;

const short = i16;
const ushort = u16;

function i32(x) {
    return x | 0;
}

i32.bytes = 4;

function u32(x) {
    return x >>> 0;
}

u32.bytes = 4;

const usize = u32;
const isize = i32;
const int = i32;
const uint = u32;

