param([switch]$Uninstall,[switch]$Preview,[string]$At='00:05')
$ErrorActionPreference='Stop'
$taskName='LotusLearn Daily Topics'
if($Uninstall){Unregister-ScheduledTask -TaskName $taskName -Confirm:$false;return}
$projectPath=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodePath=(Get-Command node.exe -ErrorAction Stop).Source
$scriptPath=Join-Path $projectPath 'server\scripts\daily-topic-generate.js'
$arguments='--disable-warning=ExperimentalWarning "'+$scriptPath+'"'
if($Preview){[pscustomobject]@{Name=$taskName;Execute=$nodePath;Arguments=$arguments;WorkingDirectory=$projectPath;Daily=$At;AtLogon=$true};return}
$action=New-ScheduledTaskAction -Execute $nodePath -Argument $arguments -WorkingDirectory $projectPath
$daily=New-ScheduledTaskTrigger -Daily -At $At
$logon=New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 12) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($daily,$logon) -Settings $settings -Principal $principal -Description 'Local Daily Topic generation and missed-date recovery. Requires running local Ollama.'
