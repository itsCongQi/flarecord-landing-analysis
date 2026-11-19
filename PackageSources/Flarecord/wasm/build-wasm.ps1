# Builds modules\flarecord_storage.wasm with the compiler that ships in the MSFS 2024 SDK.
# Visual Studio is not needed: clang-cl and wasm-ld are called directly, with the flags the SDK's
# MSFS platform toolset uses for a standalone module.
#
#   powershell -ExecutionPolicy Bypass -File build-wasm.ps1 [-Sdk "C:\MSFS 2024 SDK"] [-Out <folder>]
param(
  [string]$Sdk = $(if ($env:MSFS2024_SDK) { $env:MSFS2024_SDK.TrimEnd('\') } else { 'C:\MSFS 2024 SDK' }),
  [string]$Out = "$PSScriptRoot\..\modules"
)
$ErrorActionPreference = 'Stop'
$bin = "$Sdk\WASM\llvm\bin"
$lib = "$Sdk\WASM\wasi-sysroot\lib\wasm32-wasi"
if (-not (Test-Path "$bin\clang-cl.exe")) { throw "MSFS 2024 SDK compiler not found at $bin" }

New-Item -ItemType Directory -Force $Out | Out-Null
$obj = Join-Path ([IO.Path]::GetTempPath()) 'flarecord_storage.o'
$wasm = Join-Path $Out 'flarecord_storage.wasm'

& "$bin\clang-cl.exe" --driver-mode=gcc -c "$PSScriptRoot\flarecord_storage.cpp" -o $obj `
  --target=wasm32-unknown-wasi "--sysroot=$Sdk\WASM\wasi-sysroot" `
  -isystem "$Sdk\WASM\include" `
  -D_MSFS_WASM=1 -D__wasi__ -DNDEBUG -D_STRING_H_CPLUSPLUS_98_CONFORMANCE_ -D_WCHAR_H_CPLUSPLUS_98_CONFORMANCE_ `
  -D_LIBCPP_NO_EXCEPTIONS -D_LIBCPP_HAS_NO_THREADS `
  -fno-exceptions -fms-extensions -fvisibility=hidden -mthread-model single -mbulk-memory `
  -O2 -ffunction-sections -fdata-sections -std=c++17 -Wall
if ($LASTEXITCODE -ne 0) { throw "compile failed ($LASTEXITCODE)" }

& "$bin\wasm-ld.exe" $obj "$Sdk\WASM\WasmVersions\MSFS_WasmVersions.a" -o $wasm `
  --no-entry --allow-undefined -L $lib -lc++ -lc++abi -lc "$lib\libclang_rt.builtins-wasm32.a" `
  --export-dynamic --export=__wasm_call_ctors --export=malloc --export=free --export=mallinfo `
  --export=mchunkit_begin --export=mchunkit_next --export=get_pages_state --export=mark_decommit_pages `
  --export=GetSimConnectVersion --export=GetExtensionVersion --export=GetExtensionVersionBuffer `
  --export-table --gc-sections -O3 --strip-debug
if ($LASTEXITCODE -ne 0) { throw "link failed ($LASTEXITCODE)" }

Remove-Item $obj -ErrorAction SilentlyContinue
"Built $wasm : $((Get-Item $wasm).Length) bytes"
