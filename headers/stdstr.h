#include <import.h>
#ifndef STDSTR_H
#define STDSTR_H

IMPORT("libc.so", "charToLower")
char charToLower(char c);

IMPORT("libc.so", "charToUpper")
char charToUpper(char c);

#endif
