use anchor_lang::prelude::*;

declare_id!("2vA1TqkN3zQ49CNwDjTf2HfLYEGKgDggPVHTprmFsYe4");

#[program]
pub mod merkle_distribution {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
