use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use std::mem::size_of;

declare_id!("ASJfDuKi5Di3Shb6TtEshYm8VMbZufGLWR65GgzFvJNe");

#[program]
pub mod nft_marketplace {
    use super::*;

    pub fn initialize_marketplace(ctx: Context<InitializeMarketplace>, fee: u64 ) -> Result<()> {
        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.authority = ctx.accounts.signer.key();
        marketplace.fee = fee;
        Ok(())
    }

    pub fn list_nft(ctx: Context<ListNFT>, price: u64, payment_mint: Option<Pubkey>) -> Result<()> {

        require!(price > 0, MarketplaceError::InvalidPrice);

        let cpi_accounts = TransferChecked {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.seller_token_account.to_account_info(),
            to: ctx.accounts.escrow_account.to_account_info(),
            authority: ctx.accounts.seller.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token_interface::transfer_checked(cpi_ctx, 1, 0)?;

        let nft_listing = &mut ctx.accounts.nft_listing;
        nft_listing.seller = ctx.accounts.seller.key();
        nft_listing.price = price;
        nft_listing.payment_mint = payment_mint;

        Ok(())
    }


    pub fn buy_nft(ctx: Context<BuyNFT>) -> Result<()> {

        let nft_listing = &mut ctx.accounts.nft_listing;
        let payment_mint = &ctx.accounts.payment_mint;
        let buyer_payment_account = &ctx.accounts.buyer_payment_account;
        let seller_payment_account = &ctx.accounts.seller_payment_account;
        let price = nft_listing.price;
        let mint_key = &ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", mint_key.as_ref(), &[ctx.bumps.escrow_account]]];

        match (nft_listing.payment_mint, payment_mint, buyer_payment_account, seller_payment_account) {

            (Some(listing_mint), Some(provided_mint), Some(buyer), Some(seller)) => {

                require_keys_eq!(listing_mint, provided_mint.key(), MarketplaceError::PaymentMintMismatch);
                require_keys_eq!(listing_mint, buyer.mint, MarketplaceError::PaymentMintMismatch);
                require_keys_eq!(listing_mint, seller.mint, MarketplaceError::PaymentMintMismatch);

                let decimals = provided_mint.decimals;
                let cpi_accounts = TransferChecked {
                    mint: provided_mint.to_account_info(),
                    from: buyer.to_account_info(),
                    to: seller.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                };
                
                let cpi_program = ctx.accounts.token_program.to_account_info();
                let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
                token_interface::transfer_checked(cpi_ctx, price, decimals)?;

            }

            (None, None, None, None) => {

                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.buyer.to_account_info(),
                            to: ctx.accounts.seller.to_account_info(),
                        },
                    ),
                    price,
                )?;

            },

            _ => return Err(MarketplaceError::PaymentMintMismatch.into()),

        }

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.escrow_account.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.escrow_account.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer_seeds);
        token_interface::transfer_checked(cpi_ctx, 1, 0)?;

        // Close the account and send the rent to the seller
        token_interface::close_account(CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_interface::CloseAccount {
                account: ctx.accounts.escrow_account.to_account_info(),
                destination: ctx.accounts.seller.to_account_info(),
                authority: ctx.accounts.escrow_account.to_account_info(),
            }).with_signer(signer_seeds)
        )?;

        nft_listing.close(ctx.accounts.seller.to_account_info())?;

        Ok(())
    }



    pub fn cancel_nft(ctx: Context<CancelNFT>) -> Result<()> {

        let nft_listing = &mut ctx.accounts.nft_listing;
        let mint_key = &ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", mint_key.as_ref(), &[ctx.bumps.escrow_account]]];

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.escrow_account.to_account_info(),
            to: ctx.accounts.seller_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.escrow_account.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer_seeds);
        token_interface::transfer_checked(cpi_ctx, 1, 0)?;

        token_interface::close_account(
            CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_interface::CloseAccount {
                account: ctx.accounts.escrow_account.to_account_info(),
                destination: ctx.accounts.seller.to_account_info(),
                authority: ctx.accounts.escrow_account.to_account_info(),
            }).with_signer(signer_seeds)
        )?;

        nft_listing.close(ctx.accounts.seller.to_account_info())?;

        Ok(())
    }





}

#[derive(Accounts)]
pub struct InitializeMarketplace<'info> {

    #[account(
        init, 
        payer = signer, 
        space = size_of::<Marketplace>() + 8 ,
        seeds = [b"marketplace"],
        bump
    )]
    pub marketplace: Account<'info, Marketplace>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,

}

#[derive(Accounts)]
pub struct ListNFT<'info> {

    #[account(
        init_if_needed,
        payer = seller,
        space = size_of::<NFTListing>() + 8,
        seeds = [b"listing", mint.key().as_ref()],
        bump
    )]
    pub nft_listing: Account<'info, NFTListing>,

    #[account(
        init_if_needed,
        payer = seller,
        token::mint = mint,
        token::authority = escrow_account,
        token::token_program = token_program,
        seeds = [b"escrow", mint.key().as_ref()],
        bump
    )]
    pub escrow_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = seller,
        associated_token::token_program = token_program
    )]
    pub seller_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        constraint = seller_token_account.mint == mint.key() @ MarketplaceError::InvalidMint,
        constraint = mint.supply == 1 @ MarketplaceError::InvalidMint,
        constraint = mint.decimals == 0 @ MarketplaceError::InvalidMint,
        constraint = mint.mint_authority.is_none() @ MarketplaceError::InvalidMint
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub seller: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>, 

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyNFT<'info> {

    #[account(
        mut,
        seeds = [b"listing", mint.key().as_ref()],
        bump,
        close = seller
    )]
    pub nft_listing: Account<'info, NFTListing>,

    #[account(
        mut,
        seeds = [b"escrow", mint.key().as_ref()],
        bump
    )]
    pub escrow_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program
    )]
    pub buyer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        constraint = buyer_token_account.mint == mint.key() @ MarketplaceError::InvalidMint
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = payment_mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program,
    )]
    pub buyer_payment_account: Option<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = payment_mint,
        associated_token::authority = seller,
        associated_token::token_program = token_program
    )]
    pub seller_payment_account: Option<InterfaceAccount<'info, TokenAccount>>,

    #[account()]
    pub payment_mint: Option<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK
    #[account(
        mut,
        constraint = nft_listing.seller == seller.key() @ MarketplaceError::NotOwner
    )]
    pub seller: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>, 

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
pub struct CancelNFT<'info> {

    #[account(
        mut,
        seeds = [b"listing", mint.key().as_ref()],
        bump,
        close = seller
    )]
    pub nft_listing: Account<'info, NFTListing>,

    #[account(
        mut,
        seeds = [b"escrow", mint.key().as_ref()],
        bump,
    )]
    pub escrow_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = seller,
        associated_token::token_program = token_program
    )]
    pub seller_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account()]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut, 
        constraint = nft_listing.seller == seller.key() @ MarketplaceError::NotOwner
    )]
    pub seller: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>, 

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,
}



#[account]
pub struct Marketplace {
    pub authority: Pubkey,
    pub fee: u64,
}

#[account]
pub struct NFTListing {
    pub seller: Pubkey,
    pub price: u64,
    pub payment_mint: Option<Pubkey>
}

#[error_code]
pub enum MarketplaceError {

    #[msg("SOL balance invalid")]
    SOLBalance,

    #[msg("Invalid mint account")]
    InvalidMint,

    #[msg("Must be greater than zero")]
    InvalidPrice,

    #[msg("Not owner")]
    NotOwner,

    #[msg("Payment doesn't match")]
    PaymentMintMismatch
}