BUILD := build
SRC := src

cc:=clang

CFLAGS := --target=wasm32 \
		  -fPIC \
		  -Iheaders \
		  -ffreestanding \
		  -nostdlib \
		  -nostdinc \
		  -MMD -MP \
          -matomics \
          -mbulk-memory

LDFLAGS := --target=wasm32 \
           -nostdlib \
           -Wl,--no-entry \
           -Wl,--export-all \
           -Wl,--shared \
		   -Xlinker --import-memory=env,mem \
           -Wl,--shared-memory \
           -Wl,--max-memory=16777216




main: root/lib/libc.so root/bin/main fs.json

$(BUILD)/stdio.o: src/libc/stdio.c | $(BUILD)
	$(cc) $(CFLAGS) -c $< -o $@

$(BUILD)/stdstr.o: src/libc/stdstr.c | $(BUILD)
	$(cc) $(CFLAGS) -c $< -o $@
$(BUILD)/stdkb.o: src/libc/stdkb.c | $(BUILD)
	$(cc) $(CFLAGS) -c $< -o $@

root/lib/libc.so: $(BUILD)/stdio.o $(BUILD)/stdstr.o $(BUILD)/stdkb.o | root/lib
	$(cc) $(LDFLAGS) $^ -o $@

root/lib:
	mkdir -p $@
root/bin:
	mkdir -p $@

$(BUILD)/main.o: src/main.c | $(BUILD)
	$(cc) $(CFLAGS) -c $< -o $@

root/bin/main: $(BUILD)/main.o | root/bin 
	$(cc) $(LDFLAGS) $< -o $@

fs.json: fs.cocl FORCE generate.js
	node ./generate.js ./fs.cocl ./fs.json

.PHONY: clean
.PHONY: FORCE
FORCE:

$(BUILD):
	mkdir -p $@
clean:
	rm -rf $(BUILD)
-include $(BUILD)/*.d
