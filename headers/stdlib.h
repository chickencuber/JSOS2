#include <import.h>
#include <stdint.h>
#ifndef STDLIB_H
#define STDLIB_H

IMPORT(".", "chdir")
int chdir(const char*);

IMPORT(".", "cwd")
int cwd(char*, usize);

#define loop for (;;)

IMPORT(".", "getvar")
int getvar(const char* name, char* buf, isize size);

IMPORT(".", "setvar")
int setvar(const char* name, const char* value);

IMPORT(".", "unsetvar")
int unsetvar(const char* name);

IMPORT(".", "hasvar")
int hasvar(const char* name);

IMPORT(".", "findpath")
int findpath(const char* env_name, const char* filename, char* buf, isize size);

IMPORT(".", "exit")
_Noreturn void exit(int status);

IMPORT(".", "spawn")
int spawn(const char *path, int argc, char **argv);

IMPORT(".", "wait")
int wait(int pid);

IMPORT(".", "detach")
void detach(int pid);

#endif
