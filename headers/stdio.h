#include <stdarg.h>
#include <import.h>
#include <stdint.h>
#ifndef STDIO_H
#define STDIO_H
IMPORT(".", "open")
int open(const char *path);

IMPORT(".", "execpath")
isize execpath(char* buf, usize size);

IMPORT(".", "close")
void close(int fd);

IMPORT(".", "read")
isize read(int fd, void *buf, usize size);

IMPORT(".", "write")
isize write(int fd, const void *buf, usize size);

IMPORT(".", "flush")
int flush(int fd);

IMPORT("libc.so", "vfprintf")
isize vfprintf(int fd, const char* restrict format, va_list args);


IMPORT("libc.so", "fprintf")
isize fprintf(int fd, const char* restrict format, ...);


IMPORT("libc.so", "vsnprintf")
isize vsnprintf(char* restrict buf, usize size, const char* restrict format, va_list args);


IMPORT("libc.so", "snprintf")
isize snprintf(char* restrict buf, usize size, const char* restrict format, ...);

IMPORT("libc.so", "printf")
isize printf(const char* restrict format, ...);


IMPORT(".", "seek")
isize lseek(int fd, isize offset, int whence);

#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2

#define STDIN 0
#define STDOUT 1
#define STDERR 2

#endif
