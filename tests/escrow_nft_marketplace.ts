const anchor = require("@coral-xyz/anchor");
const { BN, Program, web3 } = anchor;
const { PublicKey, SystemProgram, Keypair } = web3;
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  setAuthority,
  AuthorityType
} = require("@solana/spl-token");
const assert = require("assert");

describe("nft_marketplace", () => {

  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.AnchorProvider.local();
  const program = anchor.workspace.NftMarketplace;

  const seller = Keypair.generate();
  const buyer = Keypair.generate();

  let nftMint; 
  let usdtMint; 
  let nftMint2;

  let sellerTokenAccount;
  let sellerTokenAccount2;
  let buyerTokenAccount;
  let buyerTokenAccount2;

  let sellerPaymentAccount;
  let buyerPaymentAccount;

  let listingPda, listingBump;
  let escrowPda, escrowBump;

  let listingPda2, listingBump2;
  let escrowPda2, escrowBump2;

  let marketplacePda, marketplaceBump;

  async function airdrop(keypair, amount = 10e9) {
    const sig = await provider.connection.requestAirdrop(keypair.publicKey, amount);
    await provider.connection.confirmTransaction(sig);
  }

  before(async () => {
    await airdrop(seller);
    await airdrop(buyer);

    // Create NFT mint (supply = 1, decimals = 0)
    nftMint = Keypair.generate();
    const nftMintPubkey = await createMint(
      provider.connection,
      seller, // Payer
      seller.publicKey, // Mint authority
      null, // Freeze authority
      0, // Decimals
      nftMint
    );

    nftMint2 = Keypair.generate();
    const nftMintPubkey2 = await createMint(
      provider.connection,
      seller, // Payer
      seller.publicKey, // Mint authority
      null, // Freeze authority
      0, // Decimals
      nftMint2
    );

    sellerTokenAccount = await getAssociatedTokenAddress(nftMintPubkey, seller.publicKey);
    await createAssociatedTokenAccount(
      provider.connection,
      seller, // Payer
      nftMintPubkey,
      seller.publicKey
    );

    sellerTokenAccount2 = await getAssociatedTokenAddress(nftMintPubkey2, seller.publicKey);
    await createAssociatedTokenAccount(
      provider.connection,
      seller, // Payer
      nftMintPubkey2,
      seller.publicKey
    );

    await mintTo(
      provider.connection,
      seller, // Payer
      nftMintPubkey,
      sellerTokenAccount,
      seller, // Mint authority (Keypair)
      1 // 1 NFT
    );

    await mintTo(
      provider.connection,
      seller,
      nftMintPubkey2,
      sellerTokenAccount2,
      seller, 
      1 
    );

    await setAuthority(
      provider.connection,
      seller, // Payer
      nftMintPubkey,
      seller, // Current authority
      AuthorityType.MintTokens,
      null // Set to null to revoke
    );

    await setAuthority(
      provider.connection,
      seller, // Payer
      nftMintPubkey2,
      seller, // Current authority
      AuthorityType.MintTokens,
      null // Set to null to revoke
    );

    // Create mock USDT mint (decimals = 6)
    usdtMint = Keypair.generate();
    const usdtMintPubkey = await createMint(
      provider.connection,
      seller,
      seller.publicKey,
      null,
      6,
      usdtMint
    );

    // Create USDT ATAs and mint 100 USDT to buyer
    buyerPaymentAccount = await getAssociatedTokenAddress(usdtMintPubkey, buyer.publicKey);

    sellerPaymentAccount = await getAssociatedTokenAddress(usdtMintPubkey, seller.publicKey);

    await createAssociatedTokenAccount(
      provider.connection,
      buyer,
      usdtMintPubkey,
      buyer.publicKey
    );

    await createAssociatedTokenAccount(
      provider.connection,
      seller,
      usdtMintPubkey,
      seller.publicKey
    );

    await mintTo(
      provider.connection,
      seller,
      usdtMintPubkey,
      buyerPaymentAccount,
      seller,
      100 * 10 ** 6 // 100 USDT
    );

    // Derive marketplace PDAs
    [marketplacePda, marketplaceBump] = await PublicKey.findProgramAddress(
      [Buffer.from("marketplace")],
      program.programId
    );

    [listingPda, listingBump] = await PublicKey.findProgramAddress(
      [Buffer.from("listing"), nftMintPubkey.toBuffer()],
      program.programId
    );

    [escrowPda, escrowBump] = await PublicKey.findProgramAddress(
      [Buffer.from("escrow"), nftMintPubkey.toBuffer()],
      program.programId
    );

    [listingPda2, listingBump2] = await PublicKey.findProgramAddress(
      [Buffer.from("listing"), nftMintPubkey2.toBuffer()],
      program.programId
    );

    [escrowPda2, escrowBump2] = await PublicKey.findProgramAddress(
      [Buffer.from("escrow"), nftMintPubkey2.toBuffer()],
      program.programId
    );

  });

  it("Initializes the marketplace", async () => {
    await program.methods
      .initializeMarketplace(new BN(0))
      .accounts({
        signer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const marketplaceAccount = await program.account.marketplace.fetch(marketplacePda);
    assert.equal(marketplaceAccount.authority.toString(), provider.wallet.publicKey.toString());
    assert.equal(marketplaceAccount.fee.toString(), "0");

  });

  it("Fails to list an NFT with price 0", async () => {
    await assert.rejects(
      async () =>
        await program.methods
          .listNft(new BN(0), usdtMint.publicKey)
          .accounts({
            nftListing: listingPda,
            escrowAccount: escrowPda,
            mint: nftMint.publicKey,
            seller: seller.publicKey,
            sellerTokenAccount: sellerTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([seller])
          .rpc(),
      //Price must be greater than 0/
    );

    const listing = await program.account.nftListing.fetchNullable(listingPda);
    assert.equal(listing, null);
  });

  it("Lists an NFT for 10 USDT", async () => {

    await program.methods
      .listNft(new BN(10 * 10 ** 6), usdtMint.publicKey)
      .accounts({
        nftListing: listingPda,
        escrowAccount: escrowPda,
        mint: nftMint.publicKey,
        seller: seller.publicKey,
        sellerTokenAccount: sellerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();

    const listing = await program.account.nftListing.fetch(listingPda);
    assert.equal(listing.seller.toString(), seller.publicKey.toString());
    assert.equal(listing.price.toString(), (10 * 10 ** 6).toString());
    assert.equal(listing.paymentMint.toString(), usdtMint.publicKey.toString());

    const escrowBalance = await provider.connection.getTokenAccountBalance(escrowPda);
    assert.equal(escrowBalance.value.uiAmount, 1);

  });

  it("Fails to buy NFT with incorrect seller", async () => {
    const fakeSeller = Keypair.generate();
    const fakeSellerPaymentAccount = await getAssociatedTokenAddress(usdtMint.publicKey, fakeSeller.publicKey);
    await createAssociatedTokenAccount(provider.connection, seller, usdtMint.publicKey, fakeSeller.publicKey);

    await assert.rejects(
      async () =>
        await program.methods
          .buyNft()
          .accounts({
            nftListing: listingPda,
            escrowAccount: escrowPda,
            mint: nftMint.publicKey,
            buyerTokenAccount: buyerTokenAccount,
            buyer: buyer.publicKey,
            seller: fakeSeller.publicKey, // Wrong seller
            paymentMint: usdtMint.publicKey,
            buyerPaymentAccount: buyerPaymentAccount,
            sellerPaymentAccount: fakeSellerPaymentAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([buyer])
          .rpc(),
      //Invalid seller address provided/
    );

    // Verify payment wasn’t sent
    const buyerBalance = await provider.connection.getTokenAccountBalance(buyerPaymentAccount);
    assert.equal(buyerBalance.value.uiAmount, 100);
    const fakeSellerBalance = await provider.connection.getTokenAccountBalance(fakeSellerPaymentAccount);
    assert.equal(fakeSellerBalance.value.uiAmount, 0);
  });

  /*
  it("Cancels the NFT listing", async () => {
    await program.methods
      .cancelNft()
      .accounts({
        mint: nftMint.publicKey,
        sellerTokenAccount: sellerTokenAccount,
        seller: seller.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();

    // Verify NFT is back with seller
    const sellerBalance = await provider.connection.getTokenAccountBalance(sellerTokenAccount);
    assert.equal(sellerBalance.value.uiAmount, 1);

    await assert.rejects(
      async () => await program.account.nftListing.fetch(listingPda),
      //Account does not exist/
    );
    await assert.rejects(
      async () => await provider.connection.getTokenAccountBalance(escrowPda),
      //Failed to get token account balance/
    );

  });

  */

  it("Buys the NFT with 10 USDT", async () => {

    buyerTokenAccount = await getAssociatedTokenAddress(nftMint.publicKey, buyer.publicKey);

    await program.methods
      .buyNft()
      .accounts({
        nftListing: listingPda,
        escrowAccount: escrowPda,
        mint: nftMint.publicKey,
        buyerTokenAccount: buyerTokenAccount,
        buyer: buyer.publicKey,
        seller: seller.publicKey,
        paymentMint: usdtMint.publicKey,
        buyerPaymentAccount: buyerPaymentAccount,
        sellerPaymentAccount: sellerPaymentAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    const buyerBalance = await provider.connection.getTokenAccountBalance(buyerTokenAccount);
    assert.equal(buyerBalance.value.uiAmount, 1);

    const sellerUsdtBalance = await provider.connection.getTokenAccountBalance(sellerPaymentAccount);
    assert.equal(sellerUsdtBalance.value.uiAmount, 10);

    const buyerUsdtBalance = await provider.connection.getTokenAccountBalance(buyerPaymentAccount);
    assert.equal(buyerUsdtBalance.value.uiAmount, 90);

    await assert.rejects(
      async () => await program.account.nftListing.fetch(listingPda),
      //Account does not exist/
    );
    await assert.rejects(
      async () => await provider.connection.getTokenAccountBalance(escrowPda),
      //Failed to get token account balance/
    );

  });


  it("Lists an NFT for SOL", async () => {

    await program.methods
      .listNft(new anchor.BN(1_000_000), null)
      .accounts({
        nftListing: listingPda2,
        escrowAccount: escrowPda2,
        mint: nftMint2.publicKey,
        seller: seller.publicKey,
        sellerTokenAccount: sellerTokenAccount2,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();

      const listingAccount = await program.account.nftListing.fetch(listingPda2);
      assert.equal(listingAccount.seller.toBase58(), seller.publicKey.toBase58());
      assert.equal(listingAccount.price.toNumber(), 1_000_000);
      assert.strictEqual(listingAccount.paymentMint, null);

  });


  it("Fail to Buys NFT with SOL payment", async () => {

    buyerTokenAccount2 = await getAssociatedTokenAddress(nftMint2.publicKey, buyer.publicKey);

    await assert.rejects(
      async () => {

        await program.methods
        .buyNft()
        .accounts({
          nftListing: listingPda2,
          escrowAccount: escrowPda2,
          mint: nftMint2.publicKey,
          buyerTokenAccount: buyerTokenAccount2,
          buyer: buyer.publicKey,
          seller: seller.publicKey,
          paymentMint: usdtMint.publicKey,
          buyerPaymentAccount: null,
          sellerPaymentAccount: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      }
    )

  })


  it("Buys NFT with SOL payment", async () => {

    buyerTokenAccount2 = await getAssociatedTokenAddress(nftMint2.publicKey, buyer.publicKey);

    const sellerInitialBalance = await provider.connection.getBalance(seller.publicKey);
    const listingInitialBalance = await provider.connection.getBalance(listingPda2);
    const escrowInitialBalance = await provider.connection.getBalance(escrowPda2);
    const price = 1_000_000;

    await program.methods
      .buyNft()
      .accounts({
        nftListing: listingPda2,
        escrowAccount: escrowPda2,
        mint: nftMint2.publicKey,
        buyerTokenAccount: buyerTokenAccount2,
        buyer: buyer.publicKey,
        seller: seller.publicKey,
        paymentMint: null,
        buyerPaymentAccount: null,
        sellerPaymentAccount: null,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

      const sellerFinalBalance = await provider.connection.getBalance(seller.publicKey);
      assert.strictEqual(sellerFinalBalance, sellerInitialBalance + price + listingInitialBalance + escrowInitialBalance);

      const buyerATA = await provider.connection.getTokenAccountBalance(buyerTokenAccount2);
      assert.strictEqual(buyerATA.value.uiAmount, 1);

  })




});