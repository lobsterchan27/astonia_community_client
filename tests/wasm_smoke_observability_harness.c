#if !defined(__EMSCRIPTEN__)
#error "The WASM smoke observability harness is compiled only by the Emscripten target."
#endif

#include "wasm/astonia_smoke_observability.h"

#include <stdint.h>

int login_done;
int sockstate;
int protocol_version;
uint32_t tick;
int lasttick;
int q_size;

void wasm_smoke_harness_seed(int next_login_done, int next_sockstate, int next_protocol_version, uint32_t next_tick,
    int next_queued_ticks, int next_queue_size)
{
	login_done = next_login_done;
	sockstate = next_sockstate;
	protocol_version = next_protocol_version;
	tick = next_tick;
	lasttick = next_queued_ticks;
	q_size = next_queue_size;
}
