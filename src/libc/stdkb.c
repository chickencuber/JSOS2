#include <stdkb.h>
#include <stdio.h>

char keycode_to_ascii(i8 key, i8 mods) {
    int shift = !!(mods & MOD_SHIFT);
    int caps  = !!(mods & MOD_CAPS);

    if (key >= KEY_A && key <= KEY_Z) {
        char base = (shift ^ caps) ? 'A' : 'a';
        return base + (key - KEY_A);
    }

    if (key >= KEY_1 && key <= KEY_0) {
        static const char normal[]  = "1234567890";
        static const char shifted[] = "!@#$%^&*()";

        int index = (key == KEY_0) ? 9 : key - KEY_1;
        return shift ? shifted[index] : normal[index];
    }

    switch (key) {
        case KEY_SPACE:  return ' ';
        case KEY_ENTER:  return '\n';
        case KEY_TAB:    return '\t';
        case KEY_BACKSPACE: return '\b';

        case KEY_MINUS:          return shift ? '_' : '-';
        case KEY_EQUAL:          return shift ? '+' : '=';
        case KEY_BRACKET_LEFT:   return shift ? '{' : '[';
        case KEY_BRACKET_RIGHT:  return shift ? '}' : ']';
        case KEY_BACKSLASH:      return shift ? '|' : '\\';
        case KEY_SEMICOLON:      return shift ? ':' : ';';
        case KEY_QUOTE:          return shift ? '"' : '\'';
        case KEY_BACKQUOTE:      return shift ? '~' : '`';
        case KEY_COMMA:          return shift ? '<' : ',';
        case KEY_PERIOD:         return shift ? '>' : '.';
        case KEY_SLASH:          return shift ? '?' : '/';

        default:
            return 0;
    }
}
