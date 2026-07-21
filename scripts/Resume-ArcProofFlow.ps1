[CmdletBinding()]
param(
  [string]$MerchantAccount = "arc-checkout-deployer",
  [string]$CustomerAccount = "settlelink-customer"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$cast = Join-Path $repoRoot ".tools\foundry\cast.exe"
$rpcUrl = "https://rpc.testnet.arc.network"
$env:ARC_RPC_URL = $rpcUrl
$chainId = 5042002
$registry = "0x10d4611a4c434d990744bfd043bfacdb6d0edd08"
$factory = "0x7d1d153bbb9f9e5ea8dbb83c295bf1fce0d2772e"
$usdc = "0x3600000000000000000000000000000000000000"
$merchant = "0x4879A69d08dc2fFE9D63000B74BdEB5F22F2eCF7"
$customer = "0x29B93d1587bBfAb7cDC2AB53c18CA4C6108839Cd"
$vault = "0x6CC2aE6d5a2e4dDCCc96cF4fC35Ea4bd30F5aD8c"
$orderId = "0xbc34703ae25daa96c527c760cfd065c4c8666b4616e13f0551e03fe585072fae"
$registerHash = "0xb7baf54e15a1c32c19407ffb367d1ff5496891bccf9a937f85cd4c76402a5e19"
$createHash = "0xf1ab7fab7db0538d36ac29d94e1ed2566c8f386c7be5249e98edbc43735f3ddf"
$customerFundingHash = "0x8fa452e5dba5ebde3be34b0828ed22f6df90b81612428adef78324b9adf1b200"
$expectedAmount = 1000000
$fundingAmount = 1050000
$fromBlock = 52934350

function Read-PlainPassword([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Invoke-WithPassword {
  param([string]$Password, [string[]]$CommandArguments)
  $passwordFile = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($passwordFile, $Password, [Text.UTF8Encoding]::new($false))
    $output = & $cast @CommandArguments --password-file $passwordFile 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
    return ($output -join [Environment]::NewLine).Trim()
  }
  finally {
    if (Test-Path -LiteralPath $passwordFile) {
      $length = (Get-Item -LiteralPath $passwordFile).Length
      if ($length -gt 0) { [IO.File]::WriteAllBytes($passwordFile, [byte[]]::new($length)) }
      Remove-Item -LiteralPath $passwordFile -Force
    }
  }
}

function Send-Transaction {
  param(
    [string]$Account,
    [string]$Password,
    [string]$To,
    [string]$Signature,
    [string[]]$FunctionArguments = @()
  )
  $commandArguments = @("send", $To, $Signature) + $FunctionArguments + @(
    "--account", $Account, "--rpc-url", $rpcUrl, "--json"
  )
  $raw = Invoke-WithPassword -Password $Password -CommandArguments $commandArguments
  return $raw | ConvertFrom-Json
}

function Get-Logs([string]$Address) {
  $raw = & $cast logs --json --address $Address --from-block $fromBlock --to-block latest --rpc-url $rpcUrl 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($raw -join [Environment]::NewLine) }
  return @(($raw -join [Environment]::NewLine) | ConvertFrom-Json)
}

function Find-TransactionByTopic([string]$Address, [string]$Topic) {
  $entry = Get-Logs $Address | Where-Object {
    $_.topics[0].ToLowerInvariant() -eq $Topic.ToLowerInvariant()
  } | Select-Object -Last 1
  return $entry.transactionHash
}

function Record-IfMissing {
  param(
    [string]$Action,
    [string]$Hash,
    [string]$Contract,
    [string]$Method,
    [string]$Event,
    [string]$Topic,
    [string]$State,
    [string]$Amount = "",
    [string]$ProtocolFee = "",
    [string]$RefundExcess = ""
  )
  $evidencePath = Join-Path $repoRoot "evidence\transaction-evidence.json"
  $existing = @(Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json)
  if ($existing | Where-Object { $_.action -eq $Action }) {
    Write-Host "Evidence already recorded: $Action" -ForegroundColor Yellow
    return
  }
  $arguments = @(
    "scripts/record-transaction-evidence.mjs",
    "--action", $Action, "--environment", "testnet",
    "--network", "Arc Testnet", "--chain-id", "$chainId",
    "--rpc-env", "ARC_RPC_URL", "--tx", $Hash,
    "--contract", $Contract, "--method", $Method,
    "--expected-event", $Event, "--observed-event", $Event,
    "--resulting-state", $State, "--event-topic", $Topic,
    "--invoice-vault", $vault
  )
  if ($Amount) { $arguments += @("--amount", $Amount) }
  if ($ProtocolFee) { $arguments += @("--protocol-fee", $ProtocolFee) }
  if ($RefundExcess) { $arguments += @("--refund-excess", $RefundExcess) }
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw "Evidence recording failed for $Action" }
}

$merchantPassword = ""
$customerPassword = ""
try {
  Write-Host "SettleLink Arc proof continuation" -ForegroundColor Cyan
  Write-Host "Existing merchant, invoice and customer funding will not be repeated."
  $merchantPassword = Read-PlainPassword "Password for $MerchantAccount"
  $customerPassword = Read-PlainPassword "Password for $CustomerAccount"

  $merchantAddress = Invoke-WithPassword -Password $merchantPassword -CommandArguments @(
    "wallet", "address", "--account", $MerchantAccount
  )
  $customerAddress = Invoke-WithPassword -Password $customerPassword -CommandArguments @(
    "wallet", "address", "--account", $CustomerAccount
  )
  if ($merchantAddress.ToLowerInvariant() -ne $merchant.ToLowerInvariant()) { throw "Merchant keystore address mismatch" }
  if ($customerAddress.ToLowerInvariant() -ne $customer.ToLowerInvariant()) { throw "Customer keystore address mismatch" }

  $expiresOutput = & $cast call $vault "expiresAt()(uint64)" --rpc-url $rpcUrl 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($expiresOutput -join [Environment]::NewLine) }
  $expiresAt = [int64]([regex]::Match(($expiresOutput -join ""), '^\d+').Value)
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  if ($expiresAt -le $now + 600) { throw "Existing invoice expires too soon to continue safely" }

  $attemptTopic = (& $cast keccak "PaymentAttemptRegistered(bytes32,bytes32,address,address,uint256,uint256,uint256,uint256,uint64,uint64)").Trim()
  $transferTopic = (& $cast keccak "Transfer(address,address,uint256)").Trim()
  $settledTopic = (& $cast keccak "PaymentSettled(bytes32,address,uint256,uint256,uint256,uint256)").Trim()
  $merchantTopic = (& $cast keccak "MerchantRegistered(address,address,bytes32)").Trim()
  $createdTopic = (& $cast keccak "PaymentIntentCreated(bytes32,address,address,address,uint256,uint16,uint64,bytes32)").Trim()

  $payerOutput = & $cast call $vault "payer()(address)" --rpc-url $rpcUrl 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($payerOutput -join [Environment]::NewLine) }
  $payer = ($payerOutput -join "").Trim()
  if ($payer -eq "0x0000000000000000000000000000000000000000") {
    $quoteExpiresAt = $now + 1200
    $attemptExpiresAt = [Math]::Min($now + 2400, $expiresAt - 60)
    $attemptId = (& $cast keccak "SETTLELINK-CONTINUATION-$now-$customer").Trim()
    $typedData = @{
      types = @{
        EIP712Domain = @(
          @{ name = "name"; type = "string" },
          @{ name = "version"; type = "string" },
          @{ name = "chainId"; type = "uint256" },
          @{ name = "verifyingContract"; type = "address" }
        )
        PaymentAuthorization = @(
          @{ name = "attemptId"; type = "bytes32" },
          @{ name = "sourceChainId"; type = "uint256" },
          @{ name = "destinationChainId"; type = "uint256" },
          @{ name = "invoiceVault"; type = "address" },
          @{ name = "orderId"; type = "bytes32" },
          @{ name = "payer"; type = "address" },
          @{ name = "refundAddress"; type = "address" },
          @{ name = "destinationAmount"; type = "uint256" },
          @{ name = "maximumSourceAmount"; type = "uint256" },
          @{ name = "quoteExpiresAt"; type = "uint64" },
          @{ name = "nonce"; type = "uint256" },
          @{ name = "attemptExpiresAt"; type = "uint64" }
        )
      }
      primaryType = "PaymentAuthorization"
      domain = @{ name = "SettleLink"; version = "1"; chainId = $chainId; verifyingContract = $vault }
      message = @{
        attemptId = $attemptId; sourceChainId = 84532; destinationChainId = $chainId
        invoiceVault = $vault; orderId = $orderId; payer = $customer; refundAddress = $customer
        destinationAmount = $expectedAmount; maximumSourceAmount = $expectedAmount
        quoteExpiresAt = $quoteExpiresAt; nonce = 1; attemptExpiresAt = $attemptExpiresAt
      }
    } | ConvertTo-Json -Depth 8 -Compress
    $typedDataFile = [IO.Path]::GetTempFileName()
    try {
      [IO.File]::WriteAllText($typedDataFile, $typedData, [Text.UTF8Encoding]::new($false))
      $signature = Invoke-WithPassword -Password $customerPassword -CommandArguments @(
        "wallet", "sign", "--data", "--from-file", $typedDataFile,
        "--account", $CustomerAccount
      )
    }
    finally { Remove-Item -LiteralPath $typedDataFile -Force -ErrorAction SilentlyContinue }
    $authorization = "($attemptId,84532,$chainId,$vault,$orderId,$customer,$customer,$expectedAmount,$expectedAmount,$quoteExpiresAt,1,$attemptExpiresAt)"
    $attemptReceipt = Send-Transaction -Account $CustomerAccount -Password $customerPassword `
      -To $vault `
      -Signature "registerPaymentAttempt((bytes32,uint256,uint256,address,bytes32,address,address,uint256,uint256,uint64,uint256,uint64),bytes)" `
      -FunctionArguments @($authorization, $signature)
    $attemptHash = $attemptReceipt.transactionHash
    Write-Host "Payment attempt registered: $attemptHash" -ForegroundColor Green
  }
  else {
    if ($payer.ToLowerInvariant() -ne $customer.ToLowerInvariant()) { throw "Vault payer does not match customer" }
    $attemptHash = Find-TransactionByTopic $vault $attemptTopic
    Write-Host "Using existing payment attempt: $attemptHash" -ForegroundColor Yellow
  }

  $balanceOutput = & $cast call $usdc "balanceOf(address)(uint256)" $vault --rpc-url $rpcUrl 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($balanceOutput -join [Environment]::NewLine) }
  $vaultBalance = [int64]([regex]::Match(($balanceOutput -join ""), '^\d+').Value)
  if ($vaultBalance -lt $expectedAmount) {
    $fundingReceipt = Send-Transaction -Account $CustomerAccount -Password $customerPassword `
      -To $usdc -Signature "transfer(address,uint256)" -FunctionArguments @($vault, "$fundingAmount")
    $fundingHash = $fundingReceipt.transactionHash
    Write-Host "Vault funded directly on Arc: $fundingHash" -ForegroundColor Green
  }
  else {
    $vaultTopic = "0x" + ("0" * 24) + $vault.Substring(2).ToLowerInvariant()
    $fundingLog = Get-Logs $usdc | Where-Object {
      $_.topics[0].ToLowerInvariant() -eq $transferTopic.ToLowerInvariant() -and
      $_.topics[2].ToLowerInvariant() -eq $vaultTopic
    } | Select-Object -Last 1
    $fundingHash = $fundingLog.transactionHash
    Write-Host "Using existing vault funding: $fundingHash" -ForegroundColor Yellow
  }

  $stateOutput = & $cast call $vault "paymentState()(uint8)" --rpc-url $rpcUrl 2>&1
  $state = [int]([regex]::Match(($stateOutput -join ""), '^\d+').Value)
  if ($state -ne 3) {
    $settlementReceipt = Send-Transaction -Account $MerchantAccount -Password $merchantPassword `
      -To $vault -Signature "settle()"
    $settlementHash = $settlementReceipt.transactionHash
    Write-Host "Vault settled: $settlementHash" -ForegroundColor Green
  }
  else {
    $settlementHash = Find-TransactionByTopic $vault $settledTopic
    Write-Host "Using existing settlement: $settlementHash" -ForegroundColor Yellow
  }

  $finalState = (& $cast call $vault "paymentState()(uint8)" --rpc-url $rpcUrl).Trim()
  $finalBalance = (& $cast call $usdc "balanceOf(address)(uint256)" $vault --rpc-url $rpcUrl).Trim()
  if ($finalState -notmatch '^3' -or $finalBalance -notmatch '^0') { throw "Final vault state verification failed" }
  & $cast call $vault "settle()" --from $customer --rpc-url $rpcUrl 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { throw "Second settlement unexpectedly succeeded" }
  Write-Host "Second settlement correctly reverted."

  Record-IfMissing -Action "Merchant registration" -Hash $registerHash -Contract $registry `
    -Method "registerMerchant" -Event "MerchantRegistered" -Topic $merchantTopic `
    -State "merchant active with payout $merchant"
  Record-IfMissing -Action "Invoice creation" -Hash $createHash -Contract $factory `
    -Method "createPaymentIntent" -Event "PaymentIntentCreated" -Topic $createdTopic `
    -State "invoice vault created at $vault" -Amount "1.000000 USDC"
  Record-IfMissing -Action "Payment attempt registration" -Hash $attemptHash -Contract $vault `
    -Method "registerPaymentAttempt" -Event "PaymentAttemptRegistered" -Topic $attemptTopic `
    -State "customer authorization locked" -Amount "1.000000 USDC"
  Record-IfMissing -Action "Vault funding (direct Arc Testnet)" -Hash $fundingHash -Contract $usdc `
    -Method "transfer" -Event "Transfer" -Topic $transferTopic `
    -State "vault funded directly on Arc Testnet; not CCTP evidence" -Amount "1.050000 USDC"
  Record-IfMissing -Action "Arc settlement" -Hash $settlementHash -Contract $vault `
    -Method "settle" -Event "PaymentSettled" -Topic $settledTopic `
    -State "vault settled; second settlement reverted" -Amount "1.000000 USDC" `
    -ProtocolFee "0.002500 USDC" -RefundExcess "0.050000 USDC"

  Write-Host "Proof flow and evidence recording completed." -ForegroundColor Green
  [ordered]@{
    merchantRegistration = $registerHash; invoiceCreation = $createHash
    customerWalletFunding = $customerFundingHash; paymentAttempt = $attemptHash
    invoiceVault = $vault; vaultFunding = $fundingHash; settlement = $settlementHash
    finalState = "Settled"; secondSettlement = "reverted"
  } | ConvertTo-Json
}
finally {
  $merchantPassword = $null
  $customerPassword = $null
}
