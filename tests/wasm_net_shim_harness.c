#if !defined(__EMSCRIPTEN__)
#error "The WASM network shim harness is compiled only by the Emscripten target."
#endif

#include "astonia_net.h"

#include <stdint.h>
#include <string.h>

static astonia_sock *g_sock;

int wasm_net_harness_connect(const char *gateway_url, int port)
{
	if (g_sock) {
		astonia_net_close(g_sock);
		g_sock = 0;
	}

	g_sock = astonia_net_connect(gateway_url, (uint16_t)port, 0);
	return g_sock ? 1 : 0;
}

int wasm_net_harness_poll(int mask)
{
	return astonia_net_poll(g_sock, mask, 0);
}

int wasm_net_harness_send_fixture(void)
{
	static const unsigned char payload[] = {0x00, 0xff, 0x41, 0x0a, 0x80, 0x7f};
	return (int)astonia_net_send(g_sock, payload, sizeof(payload));
}

int wasm_net_harness_recv(unsigned char *dst, int cap)
{
	return (int)astonia_net_recv(g_sock, dst, (size_t)cap);
}

int wasm_net_harness_recv_reply_fixture(void)
{
	static const unsigned char expected[] = {0x13, 0x00, 0xfe, 0x20, 0x99};
	unsigned char buf[sizeof(expected)];
	int n = (int)astonia_net_recv(g_sock, buf, sizeof(buf));

	if (n != (int)sizeof(expected)) {
		return -1000 + n;
	}

	if (memcmp(buf, expected, sizeof(expected)) != 0) {
		return -2000;
	}

	return n;
}

int wasm_net_harness_local_ipv4(uint32_t *out_be)
{
	return astonia_net_local_ipv4(g_sock, out_be);
}

int wasm_net_harness_peer_ipv4(uint32_t *out_be)
{
	return astonia_net_peer_ipv4(g_sock, out_be);
}

int wasm_net_harness_ipv4_placeholders_ok(void)
{
	uint32_t local = 0xffffffffu;
	uint32_t peer = 0xffffffffu;

	if (astonia_net_local_ipv4(g_sock, &local) != 0 || local != 0) {
		return 0;
	}

	if (astonia_net_peer_ipv4(g_sock, &peer) != 0 || peer != 0) {
		return 0;
	}

	return 1;
}

void wasm_net_harness_close(void)
{
	astonia_net_close(g_sock);
	g_sock = 0;
}
