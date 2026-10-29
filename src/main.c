#include <stdio.h>
#include <stdkb.h>
#include <stdstr.h>
#include <stdutil.h>

int main() {
    int fd = open("/dev/kb");
    loop {
        KeyEvent event;
        int r = read(fd, &event, 3); // one key at a time
        if (r == 0)
            continue;
        if (event.type != KEY_RELEASED) {
            switch (event.key) {
            case KEY_ARROW_LEFT:
                printf("\x1b[D");
                break;
            case KEY_ARROW_RIGHT:
                printf("\x1b[C");
                break;
            case KEY_ARROW_UP:
                printf("\x1b[A");
                break;
            case KEY_ARROW_DOWN:
                printf("\x1b[B");
                break;
            default: {
                char c = keycode_to_ascii(event.key, event.mods);
                if (c)
                    printf("%c", c);
                break;
            }
            }
        }
    }
    close(fd);
    return 0;
}
