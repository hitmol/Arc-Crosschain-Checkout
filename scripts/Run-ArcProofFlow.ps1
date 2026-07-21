[CmdletBinding()]
param(
  [string]$MerchantAccount = "arc-checkout-deployer",
  [string]$CustomerAccount = "settlelink-customer"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$cast = Join-Path $repoRoot ".tools\foundry\cast.exe"
$rpcUrl = "https://rpc.testnet.arc.network"
$chainId = 5042002
$registry = "0x10d4611a4c434d990744bfd043bfacdb6d0edd08"
$factory = "0x7d1d153bbb9f9e5ea8dbb83c295bf1fce0d2772e"
$usdc = "0x3600000000000000000000000000000000000000"
$treasury = "0x667a87b5bc9e461aa991055aa25e3d8674c42969"
$expectedAmount = 1000000
$fundingAmount = 1050000

if (-not (Test-Path -LiteralPath $cast)) {
  throw "Foundry cast was not found at $cast"
}

function Read-PlainPassword([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Invoke-CastWithPassword {
  param(
    [Parameter(Mandatory)] [string]$Password,
    [Parameter(Mandatory)] [string[]]$Arguments
  )
  $passwordFile = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText(
      $passwordFile,
      $Password,
      [Text.UTF8Encoding]::new($false)
    )
    $output = & $cast @Arguments --password-file $passwordFile 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
    return ($output -join [Environment]::NewLine).Trim()
  }
  finally {
    if (Test-Path -LiteralPath $passwordFile) {
      $length = (Get-Item -LiteralPath $passwordFile).Length
      if ($length -gt 0) {
        [IO.File]::WriteAllBytes($passwordFile, [byte[]]::new($length))
      }
      Remove-Item -LiteralPath $passwordFile -Force
    }
  }
}

function Invoke-CastRead([string[]]$Arguments) {
  $output = & $cast @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  return ($output -join [Environment]::NewLine).Trim()
}

function Get-ContractLogs([string]$Address, [int64]$FromBlock = 52933000) {
  $raw = Invoke-CastRead @(
    "logs", "--json", "--address", $Address,
    "--from-block", "$FromBlock", "--to-block", "latest",
    "--rpc-url", $rpcUrl
  )
  return @($raw | ConvertFrom-Json)
}

function Sign-TypedData {
  param(
    [string]$Account,
    [string]$Password,
    [string]$Json
  )
  $typedDataFile = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText(
      $typedDataFile,
      $Json,
      [Text.UTF8Encoding]::new($false)
    )
    return Invoke-CastWithPassword -Password $Password -Arguments @(
      "wallet", "sign", "--data", "--from-file", $typedDataFile,
      "--account", $Account
    )
  }
  finally {
    Remove-Item -LiteralPath $typedDataFile -Force -ErrorAction SilentlyContinue
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
  $arguments = @(
    "send", $To, $Signature
  ) + $FunctionArguments + @(
    "--account", $Account,
    "--rpc-url", $rpcUrl,
    "--json"
  )
  $raw = Invoke-CastWithPassword -Password $Password -Arguments $arguments
  try { return $raw | ConvertFrom-Json }
  catch { throw "cast did not return a JSON receipt: $raw" }
}

function Record-Evidence {
  param(
    [string]$Action,
    [string]$Hash,
    [string]$Contract,
    [string]$Method,
    [string]$Event,
    [string]$EventTopic,
    [string]$State,
    [string]$InvoiceVault = "",
    [string]$Amount = "",
    [string]$Payout = "",
    [string]$ProtocolFee = "",
    [string]$RefundExcess = ""
  )
  $arguments = @(
    "scripts/record-transaction-evidence.mjs",
    "--action", $Action,
    "--environment", "testnet",
    "--network", "Arc Testnet",
    "--chain-id", "$chainId",
    "--rpc-env", "ARC_RPC_URL",
    "--tx", $Hash,
    "--contract", $Contract,
    "--method", $Method,
    "--expected-event", $Event,
    "--observed-event", $Event,
    "--resulting-state", $State,
    "--event-topic", $EventTopic
  )
  if ($InvoiceVault) { $arguments += @("--invoice-vault", $InvoiceVault) }
  if ($Amount) { $arguments += @("--amount", $Amount) }
  if ($Payout) { $arguments += @("--payout", $Payout) }
  if ($ProtocolFee) { $arguments += @("--protocol-fee", $ProtocolFee) }
  if ($RefundExcess) { $arguments += @("--refund-excess", $RefundExcess) }
  $env:ARC_RPC_URL = $rpcUrl
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw "Evidence recording failed for $Action" }
}

$merchantPassword = ""
$customerPassword = ""
try {
  Write-Host "SettleLink Arc proof flow" -ForegroundColor Cyan
  Write-Host "Passwords stay only in this PowerShell process and are cleared on exit."
  $merchantPassword = Read-PlainPassword "Password for $MerchantAccount"
  $customerPassword = Read-PlainPassword "Password for $CustomerAccount"

  $merchant = Invoke-CastWithPassword -Password $merchantPassword -Arguments @(
    "wallet", "address", "--account", $MerchantAccount
  )
  $customer = Invoke-CastWithPassword -Password $customerPassword -Arguments @(
    "wallet", "address", "--account", $CustomerAccount
  )
  if ($merchant -notmatch '^0x[0-9a-fA-F]{40}$') { throw "Invalid merchant address output" }
  if ($customer -notmatch '^0x[0-9a-fA-F]{40}$') { throw "Invalid customer address output" }
  if ($merchant -eq $customer) { throw "Merchant and customer wallets must be different" }

  Write-Host "Merchant: $merchant"
  Write-Host "Customer: $customer"
  Write-Host "Treasury: $treasury"

  $merchantRecord = Invoke-CastRead @(
    "call", $registry, "merchantOf(address)((address,address,bytes32,bool,uint64))",
    $merchant, "--rpc-url", $rpcUrl
  )
  if ($merchantRecord -match [regex]::Escape($merchant)) {
    $merchantTopic = "0x" + ("0" * 24) + $merchant.Substring(2).ToLowerInvariant()
    $registerLog = Get-ContractLogs $registry | Where-Object {
      $_.topics[1].ToLowerInvariant() -eq $merchantTopic
    } | Select-Object -Last 1
    if (-not $registerLog) { throw "Registered merchant transaction log was not found" }
    $registerHash = $registerLog.transactionHash
    Write-Host "Using existing merchant registration: $registerHash" -ForegroundColor Yellow
  }
  else {
    $merchantMetadata = Invoke-CastRead @("keccak", "SettleLink public proof merchant")
    $register = Send-Transaction -Account $MerchantAccount -Password $merchantPassword `
      -To $registry -Signature "registerMerchant(address,bytes32)" `
      -FunctionArguments @($merchant, $merchantMetadata)
    $registerHash = $register.transactionHash
    Write-Host "Merchant registration: $registerHash" -ForegroundColor Green
  }

  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $quoteExpiresAt = $now + 1800
  $attemptExpiresAt = $now + 3600
  $attemptId = Invoke-CastRead @("keccak", "SETTLELINK-ATTEMPT-$now-$customer")
  $vaultList = Invoke-CastRead @(
    "call", $factory, "merchantVaults(address)(address[])",
    $merchant, "--rpc-url", $rpcUrl
  )
  $existingVaults = [regex]::Matches($vaultList, '0x[0-9a-fA-F]{40}') | ForEach-Object { $_.Value }
  if ($existingVaults.Count -gt 0) {
    $vault = $existingVaults[-1]
    $orderId = Invoke-CastRead @("call", $vault, "orderId()(bytes32)", "--rpc-url", $rpcUrl)
    $expiryOutput = Invoke-CastRead @("call", $vault, "expiresAt()(uint64)", "--rpc-url", $rpcUrl)
    $expiresAt = [int64]([regex]::Match($expiryOutput, '^\d+').Value)
    if ($attemptExpiresAt -ge $expiresAt) { $attemptExpiresAt = $expiresAt - 60 }
    if ($quoteExpiresAt -ge $attemptExpiresAt) { $quoteExpiresAt = $attemptExpiresAt - 60 }
    $vaultTopic = "0x" + ("0" * 24) + $vault.Substring(2).ToLowerInvariant()
    $createLog = Get-ContractLogs $factory | Where-Object {
      $_.topics[3].ToLowerInvariant() -eq $vaultTopic
    } | Select-Object -Last 1
    if (-not $createLog) { throw "Existing invoice creation log was not found" }
    $createHash = $createLog.transactionHash
    $orderLabel = "Existing verified order $orderId"
    Write-Host "Using existing invoice creation: $createHash" -ForegroundColor Yellow
  }
  else {
    $orderLabel = "SETTLELINK-PROOF-$now"
    $orderId = Invoke-CastRead @("keccak", $orderLabel)
    $invoiceMetadata = Invoke-CastRead @("keccak", "Direct Arc funding settlement proof")
    $expiresAt = $now + 7200
    $vault = Invoke-CastRead @(
      "call", $factory, "predictPaymentVault(address,bytes32)(address)",
      $merchant, $orderId, "--rpc-url", $rpcUrl
    )
    $create = Send-Transaction -Account $MerchantAccount -Password $merchantPassword `
      -To $factory `
      -Signature "createPaymentIntent(bytes32,uint256,uint64,bytes32)" `
      -FunctionArguments @($orderId, "$expectedAmount", "$expiresAt", $invoiceMetadata)
    $createHash = $create.transactionHash
    Write-Host "Invoice creation: $createHash"
  }
  Write-Host "Invoice vault: $vault" -ForegroundColor Green

  # Give the separate customer enough Arc Testnet USDC for funding and gas.
  $customerBalanceOutput = Invoke-CastRead @(
    "call", $usdc, "balanceOf(address)(uint256)", $customer, "--rpc-url", $rpcUrl
  )
  $customerBalance = [int64]([regex]::Match($customerBalanceOutput, '^\d+').Value)
  if ($customerBalance -ge 2000000) {
    $customerFundingHash = "already-funded"
    Write-Host "Customer wallet already has $customerBalance units; skipping funding." -ForegroundColor Yellow
  }
  else {
    $customerFunding = Send-Transaction -Account $MerchantAccount -Password $merchantPassword `
      -To $usdc -Signature "transfer(address,uint256)" `
      -FunctionArguments @($customer, "2500000")
    $customerFundingHash = $customerFunding.transactionHash
    Write-Host "Customer wallet funding: $customerFundingHash"
  }

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
    domain = @{
      name = "SettleLink"
      version = "1"
      chainId = $chainId
      verifyingContract = $vault
    }
    message = @{
      attemptId = $attemptId
      sourceChainId = 84532
      destinationChainId = $chainId
      invoiceVault = $vault
      orderId = $orderId
      payer = $customer
      refundAddress = $customer
      destinationAmount = $expectedAmount
      maximumSourceAmount = $expectedAmount
      quoteExpiresAt = $quoteExpiresAt
      nonce = 1
      attemptExpiresAt = $attemptExpiresAt
    }
  } | ConvertTo-Json -Depth 8 -Compress

  $signature = Sign-TypedData -Account $CustomerAccount -Password $customerPassword -Json $typedData
  if ($signature -notmatch '^0x[0-9a-fA-F]{130}$') { throw "Invalid EIP-712 signature output" }
  $authorization = "($attemptId,84532,$chainId,$vault,$orderId,$customer,$customer,$expectedAmount,$expectedAmount,$quoteExpiresAt,1,$attemptExpiresAt)"
  $attempt = Send-Transaction -Account $CustomerAccount -Password $customerPassword `
    -To $vault `
    -Signature "registerPaymentAttempt((bytes32,uint256,uint256,address,bytes32,address,address,uint256,uint256,uint64,uint256,uint64),bytes)" `
    -FunctionArguments @($authorization, $signature)
  $attemptHash = $attempt.transactionHash
  Write-Host "Payment attempt registration: $attemptHash"

  $funding = Send-Transaction -Account $CustomerAccount -Password $customerPassword `
    -To $usdc -Signature "transfer(address,uint256)" `
    -FunctionArguments @($vault, "$fundingAmount")
  $fundingHash = $funding.transactionHash
  Write-Host "Direct Arc vault funding: $fundingHash" -ForegroundColor Green

  $settlement = Send-Transaction -Account $MerchantAccount -Password $merchantPassword `
    -To $vault -Signature "settle()"
  $settlementHash = $settlement.transactionHash
  Write-Host "Settlement: $settlementHash" -ForegroundColor Green

  $paymentState = Invoke-CastRead @(
    "call", $vault, "paymentState()(uint8)", "--rpc-url", $rpcUrl
  )
  if ($paymentState -notmatch '^3') { throw "Vault did not enter Settled state: $paymentState" }
  $vaultBalance = Invoke-CastRead @(
    "call", $usdc, "balanceOf(address)(uint256)", $vault, "--rpc-url", $rpcUrl
  )
  if ($vaultBalance -notmatch '^0') { throw "Vault retained USDC after settlement: $vaultBalance" }
  try {
    Invoke-CastRead @("call", $vault, "settle()", "--from", $customer, "--rpc-url", $rpcUrl) | Out-Null
    throw "Second settlement unexpectedly succeeded"
  }
  catch {
    if ($_.Exception.Message -eq "Second settlement unexpectedly succeeded") { throw }
    Write-Host "Second settlement correctly reverted."
  }

  $topics = @{
    MerchantRegistered = Invoke-CastRead @("keccak", "MerchantRegistered(address,address,bytes32)")
    PaymentIntentCreated = Invoke-CastRead @("keccak", "PaymentIntentCreated(bytes32,address,address,address,uint256,uint16,uint64,bytes32)")
    PaymentAttemptRegistered = Invoke-CastRead @("keccak", "PaymentAttemptRegistered(bytes32,bytes32,address,address,uint256,uint256,uint256,uint256,uint64,uint64)")
    Transfer = Invoke-CastRead @("keccak", "Transfer(address,address,uint256)")
    PaymentSettled = Invoke-CastRead @("keccak", "PaymentSettled(bytes32,address,uint256,uint256,uint256,uint256)")
  }

  Record-Evidence -Action "Merchant registration" -Hash $registerHash `
    -Contract $registry -Method "registerMerchant" -Event "MerchantRegistered" `
    -EventTopic $topics.MerchantRegistered -State "merchant active with payout $merchant" `
    -Payout $merchant
  Record-Evidence -Action "Invoice creation" -Hash $createHash `
    -Contract $factory -Method "createPaymentIntent" -Event "PaymentIntentCreated" `
    -EventTopic $topics.PaymentIntentCreated -State "invoice vault created; expiry $expiresAt" `
    -InvoiceVault $vault -Amount "1.000000 USDC" -Payout $merchant
  Record-Evidence -Action "Payment attempt registration" -Hash $attemptHash `
    -Contract $vault -Method "registerPaymentAttempt" -Event "PaymentAttemptRegistered" `
    -EventTopic $topics.PaymentAttemptRegistered -State "customer authorization locked" `
    -InvoiceVault $vault -Amount "1.000000 USDC"
  Record-Evidence -Action "Vault funding (direct Arc Testnet)" -Hash $fundingHash `
    -Contract $usdc -Method "transfer" -Event "Transfer" -EventTopic $topics.Transfer `
    -State "vault funded directly on Arc Testnet; not CCTP evidence" `
    -InvoiceVault $vault -Amount "1.050000 USDC"
  Record-Evidence -Action "Arc settlement" -Hash $settlementHash `
    -Contract $vault -Method "settle" -Event "PaymentSettled" -EventTopic $topics.PaymentSettled `
    -State "vault settled; second settlement reverted" -InvoiceVault $vault `
    -Amount "1.000000 USDC" -Payout $merchant -ProtocolFee "0.002500 USDC" `
    -RefundExcess "0.050000 USDC"

  $summary = [ordered]@{
    network = "Arc Testnet"
    chainId = $chainId
    merchant = $merchant
    customer = $customer
    treasury = $treasury
    orderLabel = $orderLabel
    orderId = $orderId
    invoiceVault = $vault
    expectedAmount = "1.000000 USDC"
    directFundingAmount = "1.050000 USDC"
    protocolFee = "0.002500 USDC"
    refundedExcess = "0.050000 USDC"
    merchantRegistrationTransaction = $registerHash
    invoiceCreationTransaction = $createHash
    customerWalletFundingTransaction = $customerFundingHash
    paymentAttemptTransaction = $attemptHash
    vaultFundingTransaction = $fundingHash
    settlementTransaction = $settlementHash
    finalState = "Settled"
    secondSettlement = "reverted"
  }
  $summary | ConvertTo-Json
  Write-Host "Arc proof flow completed and evidence files were regenerated." -ForegroundColor Green
}
finally {
  $merchantPassword = $null
  $customerPassword = $null
}
