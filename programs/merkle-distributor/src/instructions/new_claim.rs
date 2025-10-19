use anchor_lang::{
    context::Context, prelude::*, solana_program::hash::hashv, system_program::{create_account, CreateAccount, System}, Accounts,
    Key, Result,
};
use anchor_spl::{
    token,
    token::{Token, TokenAccount},
};
use jito_merkle_verify::verify;

use crate::{
    error::ErrorCode,
    state::{
        claim_status::ClaimStatus, claimed_event::NewClaimEvent,
        merkle_distributor::MerkleDistributor,
    },
};

// We need to discern between leaf and intermediate nodes to prevent trivial second
// pre-image attacks.
// https://flawed.net.nz/2018/02/21/attacking-merkle-trees-with-a-second-preimage-attack
const LEAF_PREFIX: &[u8] = &[0];

/// [merkle_distributor::new_claim] accounts.
#[derive(Accounts)]
pub struct NewClaim<'info> {
    /// The [MerkleDistributor].
    #[account(mut)]
    pub distributor: Account<'info, MerkleDistributor>,

    /// Claim status PDA
    /// CHECK: Manually validated in handler
    #[account(mut)]
    pub claim_status: AccountInfo<'info>,

    /// Distributor ATA containing the tokens to distribute.
    #[account(mut)]
    pub from: Account<'info, TokenAccount>,

    /// Account to send the claimed tokens to.
    #[account(mut)]
    pub to: Account<'info, TokenAccount>,

    /// Who is claiming the tokens.
    #[account(mut)]
    pub claimant: Signer<'info>,

    /// SPL [Token] program.
    pub token_program: Program<'info, Token>,

    /// The [System] program.
    pub system_program: Program<'info, System>,
}

/// Initializes a new claim from the [MerkleDistributor].
/// 1. Increments num_nodes_claimed by 1
/// 2. Initializes claim_status
/// 3. Transfers claim_status.unlocked_amount to the claimant
/// 4. Increments total_amount_claimed by claim_status.unlocked_amount
/// CHECK:
///     1. The claim window has not expired and the distributor has not been clawed back
///     2. The claimant is the owner of the to account
///     3. Num nodes claimed is less than max_num_nodes
///     4. The merkle proof is valid
#[allow(clippy::result_large_err)]
pub fn handle_new_claim(
    ctx: Context<NewClaim>,
    amount_unlocked: u64,
    amount_locked: u64,
    proof: Vec<[u8; 32]>,
) -> Result<()> {
    let distributor = &mut ctx.accounts.distributor;

    let curr_ts = Clock::get()?.unix_timestamp;
    require!(!distributor.clawed_back, ErrorCode::ClaimExpired);

    distributor.num_nodes_claimed = distributor
        .num_nodes_claimed
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticError)?;

    require!(
        distributor.num_nodes_claimed <= distributor.max_num_nodes,
        ErrorCode::MaxNodesExceeded
    );

    let claimant_account = &ctx.accounts.claimant;

    // Verify the merkle proof.
    let node = hashv(&[
        &claimant_account.key().to_bytes(),
        &amount_unlocked.to_le_bytes(),
        &amount_locked.to_le_bytes(),
    ]);

    msg!("Computed inner hash: {:?}", node);

    let distributor = &ctx.accounts.distributor;
    let node = hashv(&[LEAF_PREFIX, &node.to_bytes()]);

    msg!("Computed leaf hash: {:?}", node);
    msg!("Stored root: {:?}", distributor.root);
    msg!("Proof length: {}", proof.len());

    require!(
        verify(proof, distributor.root, node.to_bytes()),
        ErrorCode::InvalidProof
    );

    // Create claim status PDA
    let claimant_key = claimant_account.key();
    let distributor_key = distributor.key();
    
    let (claim_status_pda, bump) = Pubkey::find_program_address(
        &[
            b"ClaimStatus",
            claimant_key.as_ref(),
            distributor_key.as_ref(),
        ],
        ctx.program_id,
    );
    
    require!(
        claim_status_pda == ctx.accounts.claim_status.key(),
        ErrorCode::InvalidProof
    );

    let claim_status_seeds = &[
        b"ClaimStatus",
        claimant_key.as_ref(),
        distributor_key.as_ref(),
        &[bump],
    ];

    // Create the PDA account
    let rent = Rent::get()?;
    let space = ClaimStatus::LEN;
    let lamports = rent.minimum_balance(space);

    create_account(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            CreateAccount {
                from: claimant_account.to_account_info(),
                to: ctx.accounts.claim_status.to_account_info(),
            },
        )
        .with_signer(&[claim_status_seeds]),
        lamports,
        space as u64,
        ctx.program_id,
    )?;

    // Initialize claim status data using Anchor's zero_copy pattern
    let mut claim_status_account = ctx.accounts.claim_status.to_account_info();
    let mut data = claim_status_account.try_borrow_mut_data()?;
    
    // Write the ClaimStatus struct fields directly
    let mut cursor = std::io::Cursor::new(&mut data[..]);
    
    // Manually serialize ClaimStatus fields
    use std::io::Write;
    cursor.write_all(&claimant_account.key().to_bytes())?;
    cursor.write_all(&amount_locked.to_le_bytes())?;
    cursor.write_all(&amount_unlocked.to_le_bytes())?;
    cursor.write_all(&0u64.to_le_bytes())?; // locked_amount_withdrawn
    
    drop(data); // Release borrow
    
    let unlocked_amount = amount_unlocked;

    let seeds = [
        b"MerkleDistributor".as_ref(),
        &distributor.mint.to_bytes(),
        &distributor.version.to_le_bytes(),
        &[ctx.accounts.distributor.bump],
    ];

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.from.to_account_info(),
                to: ctx.accounts.to.to_account_info(),
                authority: ctx.accounts.distributor.to_account_info(),
            },
        )
        .with_signer(&[&seeds[..]]),
        unlocked_amount,
    )?;

    let distributor = &mut ctx.accounts.distributor;
    distributor.total_amount_claimed = distributor
        .total_amount_claimed
        .checked_add(unlocked_amount)
        .ok_or(ErrorCode::ArithmeticError)?;

    require!(
        distributor.total_amount_claimed <= distributor.max_total_claim,
        ErrorCode::ExceededMaxClaim
    );

    // Note: might get truncated, do not rely on
    msg!(
        "Created new claim with locked {} and {} unlocked with lockup start:{} end:{}",
        amount_locked,
        unlocked_amount,
        distributor.start_ts,
        distributor.end_ts,
    );
    emit!(NewClaimEvent {
        claimant: claimant_account.key(),
        timestamp: curr_ts
    });

    Ok(())
}
