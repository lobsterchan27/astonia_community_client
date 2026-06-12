#if !defined(__EMSCRIPTEN__)
#error "The WASM network shim is compiled only by the Emscripten target."
#endif

#include "astonia_net.h"

#include <stdint.h>
#include <stdlib.h>

struct astonia_sock {
	int handle;
};

extern int __astonia_net_js_connect(const char *host, uint16_t port);
extern int __astonia_net_js_poll(int handle, int mask);
extern ptrdiff_t __astonia_net_js_recv(int handle, void *dst, size_t cap);
extern ptrdiff_t __astonia_net_js_send(int handle, const void *src, size_t len);
extern int __astonia_net_js_local_ipv4(int handle, uint32_t *out_be);
extern int __astonia_net_js_peer_ipv4(int handle, uint32_t *out_be);
extern void __astonia_net_js_close(int handle);

astonia_sock *astonia_net_connect(const char *host, uint16_t port, int timeout_ms)
{
	astonia_sock *sock;
	int handle;

	(void)timeout_ms;

	if (!host) {
		return NULL;
	}

	handle = __astonia_net_js_connect(host, port);
	if (handle <= 0) {
		return NULL;
	}

	sock = malloc(sizeof(*sock));
	if (!sock) {
		__astonia_net_js_close(handle);
		return NULL;
	}

	sock->handle = handle;
	return sock;
}

int astonia_net_poll(astonia_sock *s, int mask, int timeout_ms)
{
	(void)timeout_ms;

	if (!s) {
		return -1;
	}

	if (mask == 0) {
		return 0;
	}

	return __astonia_net_js_poll(s->handle, mask);
}

ptrdiff_t astonia_net_recv(astonia_sock *s, void *dst, size_t cap)
{
	if (!s) {
		return -1;
	}

	if (!dst || cap == 0) {
		return 0;
	}

	return __astonia_net_js_recv(s->handle, dst, cap);
}

ptrdiff_t astonia_net_send(astonia_sock *s, const void *src, size_t len)
{
	if (!s) {
		return -1;
	}

	if (!src || len == 0) {
		return 0;
	}

	return __astonia_net_js_send(s->handle, src, len);
}

int astonia_net_local_ipv4(astonia_sock *s, uint32_t *out_be)
{
	if (!s || !out_be) {
		return -1;
	}

	return __astonia_net_js_local_ipv4(s->handle, out_be);
}

int astonia_net_peer_ipv4(astonia_sock *s, uint32_t *out_be)
{
	if (!s || !out_be) {
		return -1;
	}

	return __astonia_net_js_peer_ipv4(s->handle, out_be);
}

void astonia_net_close(astonia_sock *s)
{
	if (!s) {
		return;
	}

	__astonia_net_js_close(s->handle);
	free(s);
}
