use cosmwasm_std::{
    to_binary, Api, Binary, Env, Extern, HandleResponse, HandleResult, HumanAddr, InitResponse,
    InitResult, Querier, QueryResult, StdError, StdResult, Storage, Uint128,
};
use secret_toolkit::utils::{HandleCallback, Query};
use secret_toolkit_snip20::{register_receive_msg, transfer_msg};

use crate::factory_msg::{
    FactoryHandleMsg, FactoryOffspringInfo, FactoryQueryMsg, IsKeyValidWrapper,
};
use crate::msg::{HandleMsg, InitMsg, QueryAnswer, QueryMsg};
use crate::state::{load, save, State, CONFIG_KEY};
pub const BLOCK_SIZE: usize = 256;

////////////////////////////////////// Init ///////////////////////////////////////
/// Returns InitResult
///
/// Initializes the offspring contract state.
///
/// # Arguments
///
/// * `deps` - mutable reference to Extern containing all the contract's external dependencies
/// * `env` - Env of contract's environment
/// * `msg` - InitMsg passed in with the instantiation message
pub fn init<S: Storage, A: Api, Q: Querier>(
    deps: &mut Extern<S, A, Q>,
    env: Env,
    msg: InitMsg,
) -> InitResult {
    let state = State {
        factory: msg.factory.clone(),
        label: msg.label.clone(),
        password: msg.password,
        active: true,
        offspring_addr: env.contract.address,
        description: msg.description,
        snip20: msg.snip20.clone(),
        owner: msg.owner.clone(),
        withdraw_time: msg.withdraw_time,
        withdrawn: false,
        amount: 0,
    };

    save(&mut deps.storage, CONFIG_KEY, &state)?;

    // perform register callback to factory
    let offspring = FactoryOffspringInfo {
        label: msg.label,
        password: msg.password,
    };
    let reg_offspring_msg = FactoryHandleMsg::RegisterOffspring {
        owner: msg.owner,
        offspring,
    };
    let cosmos_msg =
        reg_offspring_msg.to_cosmos_msg(msg.factory.code_hash, msg.factory.address, None)?;
    let register_snip20_msg = register_receive_msg(
        env.contract_code_hash,
        None,
        BLOCK_SIZE,
        msg.snip20.code_hash,
        msg.snip20.address,
    )?;

    Ok(InitResponse {
        messages: vec![cosmos_msg, register_snip20_msg],
        log: vec![],
    })
}

///////////////////////////////////// Handle //////////////////////////////////////
/// Returns HandleResult
///
/// # Arguments
///
/// * `deps` - mutable reference to Extern containing all the contract's external dependencies
/// * `env` - Env of contract's environment
/// * `msg` - HandleMsg passed in with the execute message
pub fn handle<S: Storage, A: Api, Q: Querier>(
    deps: &mut Extern<S, A, Q>,
    env: Env,
    msg: HandleMsg,
) -> HandleResult {
    match msg {
        HandleMsg::Receive {
            sender,
            from,
            amount,
            msg,
        } => try_receive(deps, env, sender, from, amount, msg),
        HandleMsg::Deactivate {} => try_deactivate(deps, env),
        HandleMsg::Withdraw {} => try_withdraw(deps, env),
    }
}

/// For receiving SNIP20s
pub fn try_receive<S: Storage, A: Api, Q: Querier>(
    deps: &mut Extern<S, A, Q>,
    env: Env,
    _sender: HumanAddr,
    _from: HumanAddr,
    amount: Uint128,
    _msg: Option<Binary>,
) -> HandleResult {
    let mut state: State = load(&deps.storage, CONFIG_KEY)?;

    if env.message.sender != state.snip20.address {
        return Err(StdError::generic_err(
            "Can only receive the SNIP20 registered in the contract",
        ));
    }

    if state.withdrawn {
        return Err(StdError::generic_err("Already withdrawn"));
    }

    state.amount += amount.0;
    save(&mut deps.storage, CONFIG_KEY, &state)?;

    Ok(HandleResponse {
        messages: vec![],
        log: vec![],
        data: None,
    })
}

pub fn try_withdraw<S: Storage, A: Api, Q: Querier>(
    deps: &mut Extern<S, A, Q>,
    env: Env,
) -> HandleResult {
    let mut state: State = load(&deps.storage, CONFIG_KEY)?;
    enforce_active(&state)?;

    if env.message.sender != state.owner {
        return Err(StdError::generic_err("Only the owner can withdraw"));
    }

    if state.withdrawn {
        return Err(StdError::generic_err("Already withdrawn"));
    }

    if env.block.time < state.withdraw_time {
        return Err(StdError::generic_err("Withdraw time has not passed"));
    }

    state.withdrawn = true;

    save(&mut deps.storage, CONFIG_KEY, &state)?;

    let withdraw_msg = transfer_msg(
        env.message.sender,
        Uint128::from(state.amount),
        Some("Time box withdrawal".to_string()),
        None,
        BLOCK_SIZE,
        state.snip20.code_hash,
        state.snip20.address,
    )?;

    Ok(HandleResponse {
        messages: vec![withdraw_msg],
        log: vec![],
        data: None,
    })
}

/// Returns HandleResult
///
/// deactivates the offspring and lets the factory know.
///
/// # Arguments
///
/// * `deps`  - mutable reference to Extern containing all the contract's external dependencies
/// * `env`   - Env of contract's environment
pub fn try_deactivate<S: Storage, A: Api, Q: Querier>(
    deps: &mut Extern<S, A, Q>,
    env: Env,
) -> HandleResult {
    let mut state: State = load(&deps.storage, CONFIG_KEY)?;
    enforce_active(&state)?;

    if env.message.sender != state.owner {
        return Err(StdError::Unauthorized { backtrace: None });
    }

    if !state.withdrawn {
        return Err(StdError::generic_err("Not withdrawn yet. For security reasons, you can only deactivate the contract after withdrawing"));
    }

    state.active = false;
    save(&mut deps.storage, CONFIG_KEY, &state)?;

    // let factory know
    let deactivate_msg = FactoryHandleMsg::DeactivateOffspring {
        owner: state.owner.clone(),
    }
    .to_cosmos_msg(
        state.factory.code_hash.clone(),
        state.factory.address.clone(),
        None,
    )?;

    Ok(HandleResponse {
        messages: vec![deactivate_msg],
        log: vec![],
        data: None,
    })
}

/////////////////////////////////////// Query /////////////////////////////////////
/// Returns QueryResult
///
/// # Arguments
///
/// * `deps` - reference to Extern containing all the contract's external dependencies
/// * `msg` - QueryMsg passed in with the query call
pub fn query<S: Storage, A: Api, Q: Querier>(deps: &Extern<S, A, Q>, msg: QueryMsg) -> QueryResult {
    match msg {
        QueryMsg::GetFunds {
            address,
            viewing_key,
            block_time,
        } => to_binary(&query_funds(deps, &address, viewing_key, block_time)?),
    }
}

/// Returns StdResult<CountResponse> displaying the count.
///
/// # Arguments
///
/// * `deps` - reference to Extern containing all the contract's external dependencies
/// * `address` - a reference to the address whose viewing key is being validated.
/// * `viewing_key` - String key used to authenticate the query.
fn query_funds<S: Storage, A: Api, Q: Querier>(
    deps: &Extern<S, A, Q>,
    address: &HumanAddr,
    viewing_key: String,
    block_time: u64,
) -> StdResult<QueryAnswer> {
    let state: State = load(&deps.storage, CONFIG_KEY)?;
    if state.owner == *address {
        enforce_valid_viewing_key(deps, &state, address, viewing_key)?;

        let remaining_time = if block_time > state.withdraw_time {
            0
        } else {
            state.withdraw_time - block_time
        };

        let can_withdraw = remaining_time == 0;

        Ok(QueryAnswer::FundsStatus {
            can_withdraw,
            remaining_time,
            withdrawn: state.withdrawn,
            amount: Uint128::from(state.amount),
            snip20: state.snip20.clone(),
        })
    } else {
        Err(StdError::generic_err(
            // error message chosen as to not leak information.
            "This address does not have permission and/or viewing key is not valid",
        ))
    }
}

/// Returns StdResult<()>
///
/// makes sure that the address and the viewing key match in the factory contract.
///
/// # Arguments
///
/// * `deps` - a reference to Extern containing all the contract's external dependencies.
/// * `state` - a reference to the State of the contract.
/// * `address` - a reference to the address whose viewing key is being validated.
/// * `viewing_key` - String key used to authenticate a query.
fn enforce_valid_viewing_key<S: Storage, A: Api, Q: Querier>(
    deps: &Extern<S, A, Q>,
    state: &State,
    address: &HumanAddr,
    viewing_key: String,
) -> StdResult<()> {
    let state_clone = state.clone();
    let key_valid_msg = FactoryQueryMsg::IsKeyValid {
        address: address.clone(),
        viewing_key,
    };
    let key_valid_response: IsKeyValidWrapper = key_valid_msg.query(
        &deps.querier,
        state_clone.factory.code_hash,
        state_clone.factory.address,
    )?;
    // if authenticated
    if key_valid_response.is_key_valid.is_valid {
        Ok(())
    } else {
        Err(StdError::generic_err(
            // error message chosen as to not leak information.
            "This address does not have permission and/or viewing key is not valid",
        ))
    }
}

/// Returns StdResult<()>
///
/// makes sure that the contract state is active
///
/// # Arguments
///
/// * `state` - a reference to the State of the contract.
fn enforce_active(state: &State) -> StdResult<()> {
    if state.active {
        Ok(())
    } else {
        Err(StdError::generic_err("This contract is inactive."))
    }
}
