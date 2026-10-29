#ifndef IMPORT_H
#define IMPORT_H

#define IMPORT(module, name)                                                   \
    __attribute__((import_module(module))) __attribute__((import_name(name)))

#define DLOPEN(name) "__dlopen__:"name
#define FILE(name) "__file__:"name

IMPORT(".", "dlopen")
int dlopen(const char*, const char*);

IMPORT(".", "dlclose")
void dlclose(const char*);


#endif
