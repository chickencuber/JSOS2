#include <stdarg.h>
#include <import.h>
#include <stdint.h>
#ifndef STDIO_H
#define STDIO_H

#define O_RDONLY  0x0000
#define O_WRONLY  0x0001
#define O_RDWR    0x0002

#define O_CREAT   0x0100
#define O_EXCL    0x0200
#define O_TRUNC   0x0400
#define O_APPEND  0x0800

IMPORT(".", "mkdir")
int mkdir(const char *path, int mode);

IMPORT(".", "rmdir")
int rmdir(const char *path);

IMPORT(".", "open")
int open(const char *path, int flags, int mode);

IMPORT(".", "execpath")
isize execpath(char* buf, usize size);

IMPORT(".", "close")
void close(int fd);

IMPORT(".", "read")
isize read(int fd, void *buf, usize size);

IMPORT(".", "readdir")
int readdir(int fd, char *buf, int size);

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
