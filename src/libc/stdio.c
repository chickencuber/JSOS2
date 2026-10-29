#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>

typedef struct {
    int fd;
    char* buffer;
    usize size;
    usize stored;
    isize count;
    int to_buffer;
} FormatOutput;

static int emit(FormatOutput* out, const char* s, isize len) {
    if (len <= 0)
        return 0;

    if (out->to_buffer) {
        if (out->size > 0) {
            usize available = out->size - 1 - out->stored;
            usize copy = (usize)len < available ? (usize)len : available;

            for (usize i = 0; i < copy; i++)
                out->buffer[out->stored + i] = s[i];

            out->stored += copy;
            out->buffer[out->stored] = '\0';
        }
    } else {
        isize n = write(out->fd, s, len);
        if (n != len)
            return -1;
    }

    out->count += len;
    return 0;
}

static int emit_char(FormatOutput* out, char c) { return emit(out, &c, 1); }

static int print_unsigned(FormatOutput* out, u64 value, unsigned base,
                          int uppercase) {
    char buf[64];
    const char* digits = uppercase ? "0123456789ABCDEF" : "0123456789abcdef";

    int len = 0;

    do {
        buf[len++] = digits[value % base];
        value /= base;
    } while (value);

    while (len > 0) {
        if (emit_char(out, buf[--len]) < 0)
            return -1;
    }

    return 0;
}

static isize vformat(FormatOutput* out, const char* fmt, va_list args) {
    while (*fmt) {
        if (*fmt != '%') {
            if (emit_char(out, *fmt++) < 0)
                return -1;
            continue;
        }

        fmt++;

        if (*fmt == '\0') {
            if (emit_char(out, '%') < 0)
                return -1;
            break;
        }

        if (*fmt == '%') {
            if (emit_char(out, '%') < 0)
                return -1;
            fmt++;
            continue;
        }

        switch (*fmt++) {
        case 's': {
            const char* s = va_arg(args, const char*);
            if (!s)
                s = "(null)";

            isize len = 0;
            while (s[len])
                len++;

            if (emit(out, s, len) < 0)
                return -1;
            break;
        }

        case 'c': {
            char c = (char)va_arg(args, int);
            if (emit_char(out, c) < 0)
                return -1;
            break;
        }

        case 'd':
        case 'i': {
            int value = va_arg(args, int);
            u64 magnitude;

            if (value < 0) {
                if (emit_char(out, '-') < 0)
                    return -1;

                // Avoid overflow for INT_MIN.
                magnitude = (u64)(-(i64)value);
            } else {
                magnitude = (u64)value;
            }

            if (print_unsigned(out, magnitude, 10, 0) < 0)
                return -1;
            break;
        }

        case 'u':
        case 'x':
        case 'X': {
            char conversion = *(fmt - 1);
            unsigned int value = va_arg(args, unsigned int);

            unsigned base = conversion == 'u' ? 10 : 16;

            if (print_unsigned(out, value, base, conversion == 'X') < 0)
                return -1;
            break;
        }

        default:
            if (emit_char(out, '%') < 0 || emit_char(out, *(fmt - 1)) < 0)
                return -1;
            break;
        }
    }

    return out->count;
}

isize vfprintf(int fd, const char* restrict fmt, va_list args) {
    FormatOutput out = {.fd = fd, .to_buffer = 0};

    return vformat(&out, fmt, args);
}

isize fprintf(int fd, const char* restrict format, ...) {
    va_list args;
    va_start(args, format);

    isize result = vfprintf(fd, format, args);

    va_end(args);
    return result;
}

isize printf(const char* restrict format, ...) {
    va_list args;
    va_start(args, format);

    isize result = vfprintf(STDOUT, format, args);

    va_end(args);
    return result;
}

isize vsnprintf(char* restrict str, usize size, const char* restrict format,
                va_list args) {
    FormatOutput out = {
        .buffer = str, .size = size, .stored = 0, .count = 0, .to_buffer = 1};

    if (size > 0)
        str[0] = '\0';

    return vformat(&out, format, args);
}

isize snprintf(char* restrict str, usize size, const char* restrict format,
               ...) {
    va_list args;
    va_start(args, format);

    isize result = vsnprintf(str, size, format, args);

    va_end(args);
    return result;
}
