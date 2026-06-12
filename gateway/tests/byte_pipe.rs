use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use astonia_gateway::{GatewayConfig, Shutdown, serve};
use tungstenite::{Message, connect};

#[test]
fn pipes_binary_bytes_between_websocket_client_and_tcp_server() {
    let tcp_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let tcp_addr = tcp_listener.local_addr().unwrap();
    let (tcp_received_tx, tcp_received_rx) = mpsc::channel();
    let (tcp_reply_tx, tcp_reply_rx) = mpsc::channel::<Vec<u8>>();

    let tcp_server = thread::spawn(move || {
        let (mut stream, _) = tcp_listener.accept().unwrap();
        let mut received = vec![0; 6];
        stream.read_exact(&mut received).unwrap();
        tcp_received_tx.send(received).unwrap();

        let reply = tcp_reply_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        stream.write_all(&reply).unwrap();
    });

    let gateway_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();
    let shutdown = Shutdown::new();
    let gateway_shutdown = shutdown.clone();
    let gateway = thread::spawn(move || {
        serve(
            gateway_listener,
            GatewayConfig {
                tcp_host: "127.0.0.1".to_owned(),
                tcp_port: tcp_addr.port(),
                target_port_allow_start: tcp_addr.port(),
                target_port_allow_end: tcp_addr.port(),
            },
            gateway_shutdown,
        )
        .unwrap();
    });

    let (mut websocket, _) = connect(format!("ws://{gateway_addr}")).unwrap();
    let client_payload = vec![0x00, 0xff, 0x41, 0x0a, 0x80, 0x7f];
    websocket
        .send(Message::Binary(client_payload.clone().into()))
        .unwrap();

    assert_eq!(
        tcp_received_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap(),
        client_payload
    );

    let tcp_payload = vec![0x13, 0x00, 0xfe, 0x20, 0x99];
    tcp_reply_tx.send(tcp_payload.clone()).unwrap();

    let message = websocket.read().unwrap();
    assert_eq!(message.into_data(), tcp_payload);

    shutdown.request();
    drop(websocket);
    gateway.join().unwrap();
    tcp_server.join().unwrap();
}

#[test]
fn requested_allowed_target_port_connects_to_that_tcp_backend() {
    let default_tcp_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let default_tcp_addr = default_tcp_listener.local_addr().unwrap();
    let requested_tcp_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let requested_tcp_addr = requested_tcp_listener.local_addr().unwrap();
    let (requested_received_tx, requested_received_rx) = mpsc::channel();

    let requested_tcp_server = thread::spawn(move || {
        let (mut stream, _) = requested_tcp_listener.accept().unwrap();
        let mut received = vec![0; 3];
        stream.read_exact(&mut received).unwrap();
        requested_received_tx.send(received).unwrap();
    });

    let gateway_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();
    let shutdown = Shutdown::new();
    let gateway_shutdown = shutdown.clone();
    let gateway = thread::spawn(move || {
        serve(
            gateway_listener,
            GatewayConfig {
                tcp_host: "127.0.0.1".to_owned(),
                tcp_port: default_tcp_addr.port(),
                target_port_allow_start: requested_tcp_addr.port(),
                target_port_allow_end: requested_tcp_addr.port(),
            },
            gateway_shutdown,
        )
        .unwrap();
    });

    let (mut websocket, _) = connect(format!(
        "ws://{gateway_addr}/play?target-port={}",
        requested_tcp_addr.port()
    ))
    .unwrap();
    let client_payload = vec![0x21, 0x22, 0x23];
    websocket
        .send(Message::Binary(client_payload.clone().into()))
        .unwrap();

    assert_eq!(
        requested_received_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap(),
        client_payload
    );

    shutdown.request();
    drop(websocket);
    drop(default_tcp_listener);
    gateway.join().unwrap();
    requested_tcp_server.join().unwrap();
}

#[test]
fn disallowed_requested_target_port_is_rejected_before_tcp_connect() {
    let default_tcp_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let default_tcp_addr = default_tcp_listener.local_addr().unwrap();
    let disallowed_tcp_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let disallowed_tcp_port = disallowed_tcp_listener.local_addr().unwrap().port();

    let allowed_port = if disallowed_tcp_port == u16::MAX {
        disallowed_tcp_port - 1
    } else {
        disallowed_tcp_port + 1
    };

    let gateway_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();
    let shutdown = Shutdown::new();
    let gateway_shutdown = shutdown.clone();
    let gateway = thread::spawn(move || {
        serve(
            gateway_listener,
            GatewayConfig {
                tcp_host: "127.0.0.1".to_owned(),
                tcp_port: default_tcp_addr.port(),
                target_port_allow_start: allowed_port,
                target_port_allow_end: allowed_port,
            },
            gateway_shutdown,
        )
        .unwrap();
    });

    let result = connect(format!(
        "ws://{gateway_addr}/play?target-port={disallowed_tcp_port}"
    ));

    assert!(
        result.is_err(),
        "expected disallowed target port to fail the WebSocket handshake"
    );

    shutdown.request();
    drop(default_tcp_listener);
    drop(disallowed_tcp_listener);
    gateway.join().unwrap();
}

#[test]
fn closes_websocket_when_tcp_server_closes() {
    let tcp_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let tcp_addr = tcp_listener.local_addr().unwrap();
    let (tcp_accepted_tx, tcp_accepted_rx) = mpsc::channel();

    let tcp_server = thread::spawn(move || {
        let (stream, _) = tcp_listener.accept().unwrap();
        tcp_accepted_tx.send(()).unwrap();
        drop(stream);
    });

    let gateway_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();
    let shutdown = Shutdown::new();
    let gateway_shutdown = shutdown.clone();
    let gateway = thread::spawn(move || {
        serve(
            gateway_listener,
            GatewayConfig {
                tcp_host: "127.0.0.1".to_owned(),
                tcp_port: tcp_addr.port(),
                target_port_allow_start: tcp_addr.port(),
                target_port_allow_end: tcp_addr.port(),
            },
            gateway_shutdown,
        )
        .unwrap();
    });

    let (mut websocket, _) = connect(format!("ws://{gateway_addr}")).unwrap();
    tcp_accepted_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap();

    let close = websocket.read().unwrap();
    assert!(close.is_close(), "expected WebSocket close, got {close:?}");

    shutdown.request();
    drop(websocket);
    gateway.join().unwrap();
    tcp_server.join().unwrap();
}

#[test]
fn closes_tcp_connection_when_websocket_client_closes() {
    let tcp_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let tcp_addr = tcp_listener.local_addr().unwrap();
    let (tcp_accepted_tx, tcp_accepted_rx) = mpsc::channel();
    let (tcp_read_tx, tcp_read_rx) = mpsc::channel();

    let tcp_server = thread::spawn(move || {
        let (mut stream, _) = tcp_listener.accept().unwrap();
        tcp_accepted_tx.send(()).unwrap();

        let mut byte = [0_u8; 1];
        let read = stream.read(&mut byte).unwrap();
        tcp_read_tx.send(read).unwrap();
    });

    let gateway_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();
    let shutdown = Shutdown::new();
    let gateway_shutdown = shutdown.clone();
    let gateway = thread::spawn(move || {
        serve(
            gateway_listener,
            GatewayConfig {
                tcp_host: "127.0.0.1".to_owned(),
                tcp_port: tcp_addr.port(),
                target_port_allow_start: tcp_addr.port(),
                target_port_allow_end: tcp_addr.port(),
            },
            gateway_shutdown,
        )
        .unwrap();
    });

    let (mut websocket, _) = connect(format!("ws://{gateway_addr}")).unwrap();
    tcp_accepted_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap();

    websocket.close(None).unwrap();

    assert_eq!(tcp_read_rx.recv_timeout(Duration::from_secs(2)).unwrap(), 0);

    shutdown.request();
    drop(websocket);
    gateway.join().unwrap();
    tcp_server.join().unwrap();
}

#[test]
fn closes_websocket_when_tcp_target_refuses_connection() {
    let unused_tcp_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let unused_tcp_port = unused_tcp_listener.local_addr().unwrap().port();
    drop(unused_tcp_listener);

    let gateway_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();
    let shutdown = Shutdown::new();
    let gateway_shutdown = shutdown.clone();
    let gateway = thread::spawn(move || {
        serve(
            gateway_listener,
            GatewayConfig {
                tcp_host: "127.0.0.1".to_owned(),
                tcp_port: unused_tcp_port,
                target_port_allow_start: unused_tcp_port,
                target_port_allow_end: unused_tcp_port,
            },
            gateway_shutdown,
        )
        .unwrap();
    });

    let (mut websocket, _) = connect(format!("ws://{gateway_addr}")).unwrap();

    let close = websocket.read().unwrap();
    assert!(close.is_close(), "expected WebSocket close, got {close:?}");

    shutdown.request();
    drop(websocket);
    gateway.join().unwrap();
}

#[test]
fn closes_tcp_connection_when_websocket_connection_disappears() {
    let tcp_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let tcp_addr = tcp_listener.local_addr().unwrap();
    let (tcp_accepted_tx, tcp_accepted_rx) = mpsc::channel();
    let (tcp_read_tx, tcp_read_rx) = mpsc::channel();

    let tcp_server = thread::spawn(move || {
        let (mut stream, _) = tcp_listener.accept().unwrap();
        tcp_accepted_tx.send(()).unwrap();

        let mut byte = [0_u8; 1];
        let read = stream.read(&mut byte).unwrap();
        tcp_read_tx.send(read).unwrap();
    });

    let gateway_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();
    let shutdown = Shutdown::new();
    let gateway_shutdown = shutdown.clone();
    let gateway = thread::spawn(move || {
        serve(
            gateway_listener,
            GatewayConfig {
                tcp_host: "127.0.0.1".to_owned(),
                tcp_port: tcp_addr.port(),
                target_port_allow_start: tcp_addr.port(),
                target_port_allow_end: tcp_addr.port(),
            },
            gateway_shutdown,
        )
        .unwrap();
    });

    let (websocket, _) = connect(format!("ws://{gateway_addr}")).unwrap();
    tcp_accepted_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap();

    drop(websocket);

    assert_eq!(tcp_read_rx.recv_timeout(Duration::from_secs(2)).unwrap(), 0);

    shutdown.request();
    gateway.join().unwrap();
    tcp_server.join().unwrap();
}
