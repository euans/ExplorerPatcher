@echo off
rem Builds ep_weather_patch.exe (requires administrator) and ep_weather_patch_test.exe (unelevated, /sandbox only).
rem Needs Visual Studio Build Tools and the DLLs in ..\staging (see ..\staging\MANIFEST.md).
setlocal
set "HERE=%~dp0"
set "VSDEV=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEV%" set "VSDEV=C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat"
call "%VSDEV%" -arch=amd64 -no_logo >nul || exit /b 1
cd /d "%HERE%"

if not exist payload mkdir payload
if not exist out mkdir out
for %%F in (ExplorerPatcher.amd64.dll ep_gui.dll ep_weather_host.dll ep_weather_host_stub.dll) do (
    if not exist "..\staging\%%F" ( echo missing ..\staging\%%F & exit /b 1 )
    copy /y "..\staging\%%F" "payload\%%F" >nul
)
powershell -NoProfile -ExecutionPolicy Bypass -File make_stamp.ps1 -Payload payload -Out stamp.h || exit /b 1

rem --- release
rc /nologo /fo out\release.res ep_weather_patch.rc || exit /b 1
cl /nologo /O2 /MT /W3 /D_UNICODE /DUNICODE ep_weather_patch.c out\release.res /Fo:out\release.obj /Fe:out\ep_weather_patch.exe /link /SUBSYSTEM:CONSOLE || exit /b 1

rem --- test build (same code + /sandbox, unelevated manifest)
rc /nologo /DTEST_BUILD /fo out\test.res ep_weather_patch.rc || exit /b 1
cl /nologo /O2 /MT /W3 /D_UNICODE /DUNICODE /DALLOW_SANDBOX ep_weather_patch.c out\test.res /Fo:out\test.obj /Fe:out\ep_weather_patch_test.exe /link /SUBSYSTEM:CONSOLE || exit /b 1
echo.
dir /b out\*.exe
