#include <stdstr.h>
char charToLower(char c) {
    if (c >= 'A' && c <= 'Z')
        return c + ('a' - 'A');

    return c;
}

char charToUpper(char c) {
    if (c >= 'a' && c <= 'z')
        return c - ('a' - 'A');

    return c;
}
