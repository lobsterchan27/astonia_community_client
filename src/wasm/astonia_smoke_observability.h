#ifndef ASTONIA_SMOKE_OBSERVABILITY_H
#define ASTONIA_SMOKE_OBSERVABILITY_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

int astonia_smoke_login_done(void);
int astonia_smoke_sockstate(void);
int astonia_smoke_protocol_version(void);
uint32_t astonia_smoke_tick(void);
int astonia_smoke_queued_ticks(void);
int astonia_smoke_queue_size(void);

#ifdef __cplusplus
}
#endif

#endif
