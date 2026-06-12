use std::env;
use std::net::TcpListener;
use std::process::ExitCode;

use astonia_gateway::{GatewayConfig, Shutdown, serve};

const DEFAULT_LISTEN: &str = "127.0.0.1:8787";
const DEFAULT_TCP_HOST: &str = "127.0.0.1";
const DEFAULT_TCP_PORT: u16 = 5556;
const DEFAULT_TARGET_PORT_ALLOW_START: u16 = 5556;
const DEFAULT_TARGET_PORT_ALLOW_END: u16 = 5590;

#[derive(Debug)]
struct Args {
    listen: String,
    tcp_host: String,
    tcp_port: u16,
    target_port_allow_start: u16,
    target_port_allow_end: u16,
}

fn main() -> ExitCode {
    let args = match Args::parse(env::args().skip(1)) {
        Ok(Some(args)) => args,
        Ok(None) => return ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err}");
            eprintln!();
            print_usage();
            return ExitCode::FAILURE;
        }
    };

    let listener = match TcpListener::bind(&args.listen) {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("error: failed to bind {}: {err}", args.listen);
            return ExitCode::FAILURE;
        }
    };

    let listen_addr = listener
        .local_addr()
        .map(|addr| addr.to_string())
        .unwrap_or(args.listen);

    eprintln!(
        "astonia-gateway listening on ws://{listen_addr} and piping to {}:{}; target-port allow range {}-{}",
        args.tcp_host, args.tcp_port, args.target_port_allow_start, args.target_port_allow_end
    );

    match serve(
        listener,
        GatewayConfig {
            tcp_host: args.tcp_host,
            tcp_port: args.tcp_port,
            target_port_allow_start: args.target_port_allow_start,
            target_port_allow_end: args.target_port_allow_end,
        },
        Shutdown::new(),
    ) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: gateway stopped: {err}");
            ExitCode::FAILURE
        }
    }
}

impl Args {
    fn parse(raw_args: impl IntoIterator<Item = String>) -> Result<Option<Self>, String> {
        let mut args = Self {
            listen: DEFAULT_LISTEN.to_owned(),
            tcp_host: DEFAULT_TCP_HOST.to_owned(),
            tcp_port: DEFAULT_TCP_PORT,
            target_port_allow_start: DEFAULT_TARGET_PORT_ALLOW_START,
            target_port_allow_end: DEFAULT_TARGET_PORT_ALLOW_END,
        };

        let mut iter = raw_args.into_iter();
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "-h" | "--help" => {
                    print_usage();
                    return Ok(None);
                }
                "--listen" => {
                    args.listen = next_value(&mut iter, "--listen")?;
                }
                "--tcp-host" => {
                    args.tcp_host = next_value(&mut iter, "--tcp-host")?;
                }
                "--tcp-port" => {
                    let value = next_value(&mut iter, "--tcp-port")?;
                    args.tcp_port = value
                        .parse::<u16>()
                        .map_err(|_| format!("--tcp-port must be a u16, got {value:?}"))?;
                }
                "--target-port-range" => {
                    let value = next_value(&mut iter, "--target-port-range")?;
                    let (start, end) = parse_port_range(&value)?;
                    args.target_port_allow_start = start;
                    args.target_port_allow_end = end;
                }
                _ => return Err(format!("unknown argument {arg:?}")),
            }
        }

        Ok(Some(args))
    }
}

fn next_value(
    iter: &mut impl Iterator<Item = String>,
    flag: &'static str,
) -> Result<String, String> {
    iter.next()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{flag} requires a value"))
}

fn parse_port_range(value: &str) -> Result<(u16, u16), String> {
    let (start, end) = value
        .split_once('-')
        .ok_or_else(|| format!("--target-port-range must be START-END, got {value:?}"))?;
    let start = start
        .parse::<u16>()
        .map_err(|_| format!("--target-port-range start must be a u16, got {start:?}"))?;
    let end = end
        .parse::<u16>()
        .map_err(|_| format!("--target-port-range end must be a u16, got {end:?}"))?;
    if start > end {
        return Err(format!(
            "--target-port-range start must be <= end, got {start}-{end}"
        ));
    }
    Ok((start, end))
}

fn print_usage() {
    println!(
        "Usage: astonia-gateway [--listen HOST:PORT] [--tcp-host HOST] [--tcp-port PORT] [--target-port-range START-END]\n\
\n\
Defaults:\n\
  --listen   {DEFAULT_LISTEN}\n\
  --tcp-host {DEFAULT_TCP_HOST}\n\
  --tcp-port {DEFAULT_TCP_PORT}\n\
  --target-port-range {DEFAULT_TARGET_PORT_ALLOW_START}-{DEFAULT_TARGET_PORT_ALLOW_END}"
    );
}
