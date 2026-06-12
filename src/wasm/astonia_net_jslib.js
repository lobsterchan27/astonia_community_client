mergeInto(LibraryManager.library, {
  $AstoniaNetShim: {
    nextHandle: 1,
    sockets: {},

    connect(host, port) {
      const url = this.buildUrl(host, port);
      if (!url) {
        return 0;
      }

      let ws;
      try {
        ws = new WebSocket(url);
      } catch {
        return 0;
      }

      const handle = this.nextHandle++;
      const socket = {
        ws,
        rx: [],
        rxOffset: 0,
        rxBytes: 0,
        everOpen: false,
        errored: false,
        closed: false
      };

      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        socket.everOpen = true;
      };
      ws.onerror = () => {
        socket.errored = true;
      };
      ws.onclose = () => {
        socket.closed = true;
      };
      ws.onmessage = (event) => {
        const bytes = this.messageBytes(event.data);
        if (bytes.length === 0) {
          return;
        }
        socket.rx.push(bytes);
        socket.rxBytes += bytes.length;
      };

      this.sockets[handle] = socket;
      return handle;
    },

    buildUrl(host, port) {
      const input = String(host || '').trim();
      if (!input) {
        return null;
      }

      try {
        let url;
        if (/^wss?:\/\//i.test(input)) {
          url = new URL(input);
        } else if (/^https?:\/\//i.test(input)) {
          url = new URL(input);
          url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        } else if (input.startsWith('//')) {
          const scheme =
            typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
          url = new URL(`${scheme}${input}`);
        } else {
          const scheme =
            typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
          url = new URL(`${scheme}//${input}`);
        }

        if (port > 0) {
          url.searchParams.set('target-port', String(port));
        }

        return url.toString();
      } catch {
        return null;
      }
    },

    messageBytes(data) {
      if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
      }

      if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }

      if (typeof data === 'string') {
        return new TextEncoder().encode(data);
      }

      return new Uint8Array(0);
    },

    poll(handle, mask) {
      const socket = this.sockets[handle];
      if (!socket) {
        return -1;
      }

      const ws = socket.ws;
      const readRequested = (mask & 1) !== 0;
      const writeRequested = (mask & 2) !== 0;
      let result = 0;

      if (readRequested && (socket.rxBytes > 0 || (socket.closed && socket.rxBytes === 0))) {
        result |= 1;
      }

      if (writeRequested && ws.readyState === WebSocket.OPEN) {
        result |= 2;
      }

      if (result !== 0) {
        return result;
      }

      if ((socket.errored || socket.closed) && !socket.everOpen) {
        return -1;
      }

      if (writeRequested && (socket.errored || ws.readyState === WebSocket.CLOSED)) {
        return -1;
      }

      return 0;
    },

    recv(handle, dst, cap) {
      const socket = this.sockets[handle];
      if (!socket) {
        return -1;
      }

      if (!dst || cap === 0) {
        return 0;
      }

      if (socket.rxBytes === 0) {
        return socket.closed ? 0 : -1;
      }

      let copied = 0;
      const max = Math.min(cap, socket.rxBytes);
      while (copied < max && socket.rx.length > 0) {
        const chunk = socket.rx[0];
        const remaining = chunk.length - socket.rxOffset;
        const take = Math.min(max - copied, remaining);
        HEAPU8.set(chunk.subarray(socket.rxOffset, socket.rxOffset + take), dst + copied);
        copied += take;
        socket.rxOffset += take;

        if (socket.rxOffset === chunk.length) {
          socket.rx.shift();
          socket.rxOffset = 0;
        }
      }

      socket.rxBytes -= copied;
      return copied;
    },

    send(handle, src, len) {
      const socket = this.sockets[handle];
      if (!socket) {
        return -1;
      }

      if (!src || len === 0) {
        return 0;
      }

      if (socket.ws.readyState !== WebSocket.OPEN) {
        return socket.closed ? 0 : -1;
      }

      try {
        socket.ws.send(new Uint8Array(HEAPU8.subarray(src, src + len)));
      } catch {
        socket.errored = true;
        return -1;
      }

      return len;
    },

    ipv4(handle, outPtr) {
      if (!this.sockets[handle] || !outPtr) {
        return -1;
      }

      HEAPU32[outPtr >> 2] = 0;
      return 0;
    },

    close(handle) {
      const socket = this.sockets[handle];
      if (!socket) {
        return;
      }

      delete this.sockets[handle];
      try {
        if (
          socket.ws.readyState === WebSocket.CONNECTING ||
          socket.ws.readyState === WebSocket.OPEN
        ) {
          socket.ws.close();
        }
      } catch {
      }
    }
  },

  __astonia_net_js_connect__deps: ['$AstoniaNetShim', '$UTF8ToString'],
  __astonia_net_js_connect: (hostPtr, port) => AstoniaNetShim.connect(UTF8ToString(hostPtr), port),

  __astonia_net_js_poll__deps: ['$AstoniaNetShim'],
  __astonia_net_js_poll: (handle, mask) => AstoniaNetShim.poll(handle, mask),

  __astonia_net_js_recv__deps: ['$AstoniaNetShim'],
  __astonia_net_js_recv: (handle, dst, cap) => AstoniaNetShim.recv(handle, dst, cap),

  __astonia_net_js_send__deps: ['$AstoniaNetShim'],
  __astonia_net_js_send: (handle, src, len) => AstoniaNetShim.send(handle, src, len),

  __astonia_net_js_local_ipv4__deps: ['$AstoniaNetShim'],
  __astonia_net_js_local_ipv4: (handle, outPtr) => AstoniaNetShim.ipv4(handle, outPtr),

  __astonia_net_js_peer_ipv4__deps: ['$AstoniaNetShim'],
  __astonia_net_js_peer_ipv4: (handle, outPtr) => AstoniaNetShim.ipv4(handle, outPtr),

  __astonia_net_js_close__deps: ['$AstoniaNetShim'],
  __astonia_net_js_close: (handle) => AstoniaNetShim.close(handle)
});
