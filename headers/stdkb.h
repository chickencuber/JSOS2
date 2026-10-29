#include <stdint.h>
#include <import.h>

#ifndef STDKB_H
#define STDKB_H

typedef struct {
    i8 type;
    i8 key;
    i8 mods;
} KeyEvent;

IMPORT("libc.so", "keycode_to_ascii")
char keycode_to_ascii(i8 key, i8 mod);

#define KEY_PRESSED 0
#define KEY_RELEASED 1

#define MOD_SHIFT 1
#define MOD_CTRL 1 << 1
#define MOD_META 1 << 2
#define MOD_ALT 1 << 3
#define MOD_CAPS 1 << 4

/* Letters */
#define KEY_A 0x04
#define KEY_B 0x05
#define KEY_C 0x06
#define KEY_D 0x07
#define KEY_E 0x08
#define KEY_F 0x09
#define KEY_G 0x0a
#define KEY_H 0x0b
#define KEY_I 0x0c
#define KEY_J 0x0d
#define KEY_K 0x0e
#define KEY_L 0x0f
#define KEY_M 0x10
#define KEY_N 0x11
#define KEY_O 0x12
#define KEY_P 0x13
#define KEY_Q 0x14
#define KEY_R 0x15
#define KEY_S 0x16
#define KEY_T 0x17
#define KEY_U 0x18
#define KEY_V 0x19
#define KEY_W 0x1a
#define KEY_X 0x1b
#define KEY_Y 0x1c
#define KEY_Z 0x1d

/* Number row */
#define KEY_1 0x1e
#define KEY_2 0x1f
#define KEY_3 0x20
#define KEY_4 0x21
#define KEY_5 0x22
#define KEY_6 0x23
#define KEY_7 0x24
#define KEY_8 0x25
#define KEY_9 0x26
#define KEY_0 0x27

/* Common keys */
#define KEY_ENTER 0x28
#define KEY_ESCAPE 0x29
#define KEY_BACKSPACE 0x2a
#define KEY_TAB 0x2b
#define KEY_SPACE 0x2c
#define KEY_MINUS 0x2d
#define KEY_EQUAL 0x2e
#define KEY_BRACKET_LEFT 0x2f
#define KEY_BRACKET_RIGHT 0x30
#define KEY_BACKSLASH 0x31
#define KEY_SEMICOLON 0x33
#define KEY_QUOTE 0x34
#define KEY_BACKQUOTE 0x35
#define KEY_COMMA 0x36
#define KEY_PERIOD 0x37
#define KEY_SLASH 0x38
#define KEY_CAPS_LOCK 0x39

/* Function keys */
#define KEY_F1 0x3a
#define KEY_F2 0x3b
#define KEY_F3 0x3c
#define KEY_F4 0x3d
#define KEY_F5 0x3e
#define KEY_F6 0x3f
#define KEY_F7 0x40
#define KEY_F8 0x41
#define KEY_F9 0x42
#define KEY_F10 0x43
#define KEY_F11 0x44
#define KEY_F12 0x45

/* Navigation keys */
#define KEY_INSERT 0x49
#define KEY_HOME 0x4a
#define KEY_PAGE_UP 0x4b
#define KEY_DELETE 0x4c
#define KEY_END 0x4d
#define KEY_PAGE_DOWN 0x4e
#define KEY_ARROW_RIGHT 0x4f
#define KEY_ARROW_LEFT 0x50
#define KEY_ARROW_DOWN 0x51
#define KEY_ARROW_UP 0x52

/* Modifier keys */
#define KEY_CONTROL_LEFT 0xe0
#define KEY_SHIFT_LEFT 0xe1
#define KEY_ALT_LEFT 0xe2
#define KEY_META_LEFT 0xe3
#define KEY_CONTROL_RIGHT 0xe4
#define KEY_SHIFT_RIGHT 0xe5
#define KEY_ALT_RIGHT 0xe6
#define KEY_META_RIGHT 0xe7

#endif
