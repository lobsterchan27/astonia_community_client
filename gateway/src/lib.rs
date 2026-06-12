use std::io::{self, Read, Write};
use std::net::{Shutdown as TcpShutdown, TcpListener, TcpStream};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::thread;
use std::time::Duration;

use tungstenite::error::Error as WebSocketError;
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::http::StatusCode;
use tungstenite::{Message, accept_hdr};

const IO_POLL_INTERVAL: Duration = Duration::from_millis(2);
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
const BUFFER_SIZE: usize = 16 * 1024;
const TARGET_PORT_QUERY_PARAM: &str = "target-port";

#[derive(Clone, Debug)]
pub struct GatewayConfig {
    pub tcp_host: String,
    pub tcp_port: u16,
    pub target_port_allow_start: u16,
    pub target_port_allow_end: u16,
}

#[derive(Clone, Debug, Default)]
pub struct Shutdown {
    requested: Arc<AtomicBool>,
}

impl Shutdown {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn request(&self) {
        self.requested.store(true, Ordering::SeqCst);
    }

    fn is_requested(&self) -> bool {
        self.requested.load(Ordering::SeqCst)
    }
}

pub fn serve(listener: TcpListener, config: GatewayConfig, shutdown: Shutdown) -> io::Result<()> {
    listener.set_nonblocking(true)?;

    while !shutdown.is_requested() {
        match listener.accept() {
            Ok((client, _)) => {
                let config = config.clone();
                thread::spawn(move || {
                    let _ = handle_client(client, config);
                });
            }
            Err(err) if err.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(IO_POLL_INTERVAL);
            }
            Err(err) => return Err(err),
        }
    }

    Ok(())
}

fn handle_client(client: TcpStream, config: GatewayConfig) -> io::Result<()> {
    let mut selected_tcp_port = config.tcp_port;
    let mut websocket = accept_hdr(client, |request: &Request, response: Response| {
        selected_tcp_port =
            select_target_port(request, &config).map_err(target_port_error_response)?;
        Ok(response)
    })
    .map_err(|err| io::Error::other(err.to_string()))?;
    let mut tcp = match TcpStream::connect((config.tcp_host.as_str(), selected_tcp_port)) {
        Ok(tcp) => tcp,
        Err(err) => {
            close_websocket(&mut websocket)?;
            return Err(err);
        }
    };
    tcp.set_nodelay(true)?;
    tcp.set_read_timeout(Some(IO_POLL_INTERVAL))?;
    tcp.set_write_timeout(Some(WRITE_TIMEOUT))?;
    websocket
        .get_mut()
        .set_read_timeout(Some(IO_POLL_INTERVAL))?;
    websocket.get_mut().set_write_timeout(Some(WRITE_TIMEOUT))?;

    let mut tcp_buffer = [0_u8; BUFFER_SIZE];

    loop {
        let mut did_work = false;

        match websocket.read() {
            Ok(Message::Binary(bytes)) => {
                tcp.write_all(&bytes)?;
                did_work = true;
            }
            Ok(Message::Text(text)) => {
                tcp.write_all(text.as_bytes())?;
                did_work = true;
            }
            Ok(Message::Close(frame)) => {
                let _ = websocket.close(frame);
                let _ = tcp.shutdown(TcpShutdown::Both);
                return Ok(());
            }
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {
                websocket.flush().map_err(to_io_error)?;
                did_work = true;
            }
            Ok(Message::Frame(_)) => {}
            Err(WebSocketError::Io(err)) if is_transient_io(&err) => {}
            Err(WebSocketError::ConnectionClosed | WebSocketError::AlreadyClosed) => {
                let _ = tcp.shutdown(TcpShutdown::Both);
                return Ok(());
            }
            Err(err) => {
                let _ = tcp.shutdown(TcpShutdown::Both);
                return Err(to_io_error(err));
            }
        }

        match tcp.read(&mut tcp_buffer) {
            Ok(0) => {
                close_websocket(&mut websocket)?;
                return Ok(());
            }
            Ok(read) => {
                websocket
                    .send(Message::binary(tcp_buffer[..read].to_vec()))
                    .map_err(to_io_error)?;
                did_work = true;
            }
            Err(err) if is_transient_io(&err) => {}
            Err(err) => {
                close_websocket(&mut websocket)?;
                return Err(err);
            }
        }

        if !did_work {
            thread::sleep(IO_POLL_INTERVAL);
        }
    }
}

fn select_target_port(request: &Request, config: &GatewayConfig) -> Result<u16, String> {
    let Some(target_port) = target_port_query_value(request.uri().query()) else {
        return Ok(config.tcp_port);
    };

    let port = target_port.parse::<u16>().map_err(|_| {
        format!("{TARGET_PORT_QUERY_PARAM} must be a u16 port, got {target_port:?}")
    })?;

    if port >= config.target_port_allow_start && port <= config.target_port_allow_end {
        Ok(port)
    } else {
        Err(format!(
            "{TARGET_PORT_QUERY_PARAM} {port} is outside the allowed range {}-{}",
            config.target_port_allow_start, config.target_port_allow_end
        ))
    }
}

fn target_port_query_value(query: Option<&str>) -> Option<&str> {
    query?.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        (key == TARGET_PORT_QUERY_PARAM).then_some(value)
    })
}

fn target_port_error_response(message: String) -> ErrorResponse {
    tungstenite::http::Response::builder()
        .status(StatusCode::FORBIDDEN)
        .body(Some(message))
        .expect("static target-port rejection response is valid")
}

fn close_websocket<S: Read + Write>(websocket: &mut tungstenite::WebSocket<S>) -> io::Result<()> {
    match websocket.close(None) {
        Ok(()) => Ok(()),
        Err(WebSocketError::ConnectionClosed | WebSocketError::AlreadyClosed) => Ok(()),
        Err(WebSocketError::Io(err)) if is_transient_io(&err) => Ok(()),
        Err(err) => Err(to_io_error(err)),
    }
}

fn is_transient_io(err: &io::Error) -> bool {
    matches!(
        err.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    )
}

fn to_io_error(err: WebSocketError) -> io::Error {
    match err {
        WebSocketError::Io(err) => err,
        other => io::Error::other(other),
    }
}
