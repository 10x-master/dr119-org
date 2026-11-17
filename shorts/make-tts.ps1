$ErrorActionPreference = 'Stop'
$outDir = 'c:\work\dr119-org\shorts\assets'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$segments = @(
  @{ Name = 'voice-1.wav'; Text = '수백만 원짜리 초음파 세척기! 고장 나서 비싼 물통으로 방치하셨나요? 초음파 세척계의 공임나라, 닥터 일일구가 살려드립니다!' },
  @{ Name = 'voice-2.wav'; Text = '사용 방법은 사진 한 장이면 끝! 첫 화면에서 고장 사진 찍고, 빨간 마이크를 눌러 말로 증상을 적으세요. 연락처와 지역 넣고, 긴급 접수하기 누르면 완료!' },
  @{ Name = 'voice-3.wav'; Text = '접수 즉시 부품 원가와 합포장 화물 실비를 백 퍼센트 공개하고, 정해진 표준 공임만 받습니다.' },
  @{ Name = 'voice-4.wav'; Text = '부도난 세척기 새것처럼 고쳐줘서 정말 고맙다는, 전국 사장님들의 채널톡 감사 후기가 쏟아지고 있습니다!' },
  @{ Name = 'voice-5.wav'; Text = '초음파 세척기 수리는 닥터 일일구! 지금 일육육일에 공칠팔삼으로 접수하세요!' }
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
[Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
$winrtSynth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$ko = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like 'ko*' } | Select-Object -First 1
if ($ko) {
  $winrtSynth.Voice = $ko
}
$winrtSynth.Options.SpeakingRate = 1.32
$winrtSynth.Options.AudioPitch = 1.05

foreach ($seg in $segments) {
  $stream = Await ($winrtSynth.SynthesizeTextToStreamAsync($seg.Text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $reader = New-Object Windows.Storage.Streams.DataReader ($stream.GetInputStreamAt(0))
  $len = [int]$stream.Size
  Await ($reader.LoadAsync($len)) ([uint32]) | Out-Null
  $bytes = New-Object byte[] $len
  $reader.ReadBytes($bytes)
  $path = Join-Path $outDir $seg.Name
  [System.IO.File]::WriteAllBytes($path, $bytes)
  $reader.Dispose()
  $stream.Dispose()
}
$winrtSynth.Dispose()
Write-Output "TTS_OK ($($ko.DisplayName))"
