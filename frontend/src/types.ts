export type ViewingKeyResponse = { viewing_key: { key: string } };
export type offspringsResponse = { list_my_offspring: { active: { address: string, label: string }[] } };
export type offspringStatus = {
  funds_status: {
    amount: string
    can_withdraw: boolean
    remaining_time: number
    withdrawn: boolean,
    snip20: {
      code_hash: string,
      address: string
    }
  },
};
