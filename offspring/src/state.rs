use std::any::type_name;

use schemars::JsonSchema;
use secret_toolkit::serialization::{Bincode2, Serde};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use cosmwasm_std::{HumanAddr, ReadonlyStorage, StdError, StdResult, Storage};

use crate::msg::ContractInfo;

pub const CONFIG_KEY: &[u8] = b"config";

/// pad handle responses and log attributes to blocks of 256 bytes to prevent leaking info based on
/// response size
pub const BLOCK_SIZE: usize = 256;

/// State of the offspring contract
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct State {
    /// factory code hash and address
    pub factory: ContractInfo,
    /// label used when initializing offspring
    pub label: String,
    /// this is relevant if the factory is listing offsprings by activity status.
    pub active: bool,
    /// used by factory for authentication
    pub password: [u8; 32],
    /// address of the offspring contract
    pub offspring_addr: HumanAddr,
    /// Optional text description of this offspring
    pub description: Option<String>,

    // snip20 contract
    pub snip20: ContractInfo,
    /// address of the owner associated to this offspring contract
    pub owner: HumanAddr,
    // when can the funds be retrieved?
    pub withdraw_time: u64,
    // are the funds retrieved?
    pub withdrawn: bool,
    // amount locked in the contract
    pub amount: u128,
}

/// Returns StdResult<()> resulting from saving an item to storage
///
/// # Arguments
///
/// * `storage` - a mutable reference to the storage this item should go to
/// * `key` - a byte slice representing the key to access the stored item
/// * `value` - a reference to the item to store
pub fn save<T: Serialize, S: Storage>(storage: &mut S, key: &[u8], value: &T) -> StdResult<()> {
    storage.set(key, &Bincode2::serialize(value)?);
    Ok(())
}

/// Removes an item from storage
///
/// # Arguments
///
/// * `storage` - a mutable reference to the storage this item is in
/// * `key` - a byte slice representing the key that accesses the stored item
pub fn remove<S: Storage>(storage: &mut S, key: &[u8]) {
    storage.remove(key);
}

/// Returns StdResult<T> from retrieving the item with the specified key.  Returns a
/// StdError::NotFound if there is no item with that key
///
/// # Arguments
///
/// * `storage` - a reference to the storage this item is in
/// * `key` - a byte slice representing the key that accesses the stored item
pub fn load<T: DeserializeOwned, S: ReadonlyStorage>(storage: &S, key: &[u8]) -> StdResult<T> {
    Bincode2::deserialize(
        &storage
            .get(key)
            .ok_or_else(|| StdError::not_found(type_name::<T>()))?,
    )
}

/// Returns StdResult<Option<T>> from retrieving the item with the specified key.
/// Returns Ok(None) if there is no item with that key
///
/// # Arguments
///
/// * `storage` - a reference to the storage this item is in
/// * `key` - a byte slice representing the key that accesses the stored item
pub fn may_load<T: DeserializeOwned, S: ReadonlyStorage>(
    storage: &S,
    key: &[u8],
) -> StdResult<Option<T>> {
    match storage.get(key) {
        Some(value) => Bincode2::deserialize(&value).map(Some),
        None => Ok(None),
    }
}
