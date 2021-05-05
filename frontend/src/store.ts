import Vue from 'vue';
import Vuex from 'vuex';
import Web3 from 'web3';
import _ from 'lodash';
import BN from 'bignumber.js';
BN.config({ ROUNDING_MODE: BN.ROUND_DOWN });
BN.config({ EXPONENTIAL_AT: 100 });

import { setUpContracts } from './contracts';
import {
  characterFromContract, targetFromContract, weaponFromContract
} from './contract-models';
import { allStakeTypes, Contracts, IStakeOverviewState, IStakeState, IState, StakeType } from './interfaces';
import { getCharacterNameFromSeed } from './character-name';

const defaultCallOptions = (state: IState) => ({ from: state.defaultAccount });

type StakingRewardsAlias = Contracts['LPStakingRewards'] | Contracts['LP2StakingRewards'] | Contracts['SkillStakingRewards'];

interface StakingContracts {
  StakingRewards: StakingRewardsAlias,
  StakingToken: Contracts['LPToken'] | Contracts['LP2Token'] | Contracts['SkillToken'],
  RewardToken: Contracts['SkillToken'],
}

function getStakingContracts(contracts: Contracts, stakeType: StakeType): StakingContracts {
  switch(stakeType) {
  case 'skill': return {
    StakingRewards: contracts.SkillStakingRewards,
    StakingToken: contracts.SkillToken,
    RewardToken: contracts.SkillToken
  };
  case 'lp': return {
    StakingRewards: contracts.LPStakingRewards,
    StakingToken: contracts.LPToken,
    RewardToken: contracts.SkillToken
  };
  case 'lp2': return {
    StakingRewards: contracts.LP2StakingRewards,
    StakingToken: contracts.LP2Token,
    RewardToken: contracts.SkillToken
  };
  }
}

interface RaidData {
  expectedFinishTime: string;
  raiderCount: number;
  bounty: string;
  totalPower: string;
  weaponDrops: string[];
  staminaDrainSeconds: number;
}

const defaultStakeState: IStakeState = {
  ownBalance: '0',
  stakedBalance: '0',
  remainingCapacityForDeposit: '0',
  remainingCapacityForWithdraw: '0',
  contractBalance: '0',
  currentRewardEarned: '0',
  rewardMinimumStakeTime: 0,
  rewardDistributionTimeLeft: 0,
  unlockTimeLeft: 0,
};

const defaultStakeOverviewState: IStakeOverviewState = {
  rewardRate: '0',
  rewardsDuration: 0,
  totalSupply: '0',
  minimumStakeTime: 0
};

export function createStore(web3: Web3, featureFlagStakeOnly: boolean) {
  return new Vuex.Store({
    state: {
      contracts: null!,

      accounts: [],
      defaultAccount: null,
      currentNetworkId: null,

      skillBalance: '0',
      ownedCharacterIds: [],
      ownedWeaponIds: [],
      maxStamina: 0,
      currentCharacterId: null,

      characters: {},
      characterStaminas: {},
      weapons: {},

      targetsByCharacterIdAndWeaponId: {},

      staking: {
        skill: { ...defaultStakeState },
        lp: { ...defaultStakeState },
        lp2: { ...defaultStakeState }
      },
      stakeOverviews: {
        skill: { ...defaultStakeOverviewState },
        lp: { ...defaultStakeOverviewState },
        lp2: { ...defaultStakeOverviewState }
      },

      raid: {
        expectedFinishTime: '0',
        raiderCount: 0,
        bounty: '0',
        totalPower: '0',
        weaponDrops: [],
        staminaDrainSeconds: 0,
        isOwnedCharacterRaidingById: {}
      }
    },

    getters: {
      getTargetsByCharacterIdAndWeaponId(state: IState) {
        return (characterId: number, weaponId: number) => {
          const targetsByWeaponId = state.targetsByCharacterIdAndWeaponId[characterId];
          if (!targetsByWeaponId) return [];

          return targetsByWeaponId[weaponId] ?? [];
        };
      },

      getCharacterName() {

        return (characterId: number) => {
          return getCharacterNameFromSeed(characterId);
        };
      },

      ownCharacters(state) {
        const characters = state.ownedCharacterIds.map((id) => state.characters[id]);
        if (characters.some((w) => w === null)) return [];
        return characters;
      },

      ownWeapons(state) {
        const weapons = state.ownedWeaponIds.map((id) => state.weapons[id]);
        if (weapons.some((w) => w === null)) return [];
        return weapons;
      },

      currentCharacter(state) {
        if (!state.currentCharacterId) return null;

        return state.characters[state.currentCharacterId];
      },

      currentCharacterStamina(state) {
        return state.currentCharacterId === null ? 0 : state.characterStaminas[state.currentCharacterId];
      },

      stakeState(state) {
        return (stakeType: StakeType): IStakeState => state.staking[stakeType];
      },

      isOwnedCharacterRaiding(state) {
        return (characterId: number): boolean => state.raid.isOwnedCharacterRaidingById[characterId] || false;
      }
    },

    mutations: {
      setNetworkId(state, payload) {
        state.currentNetworkId = payload;
      },

      setAccounts(state: IState, payload) {
        state.accounts = payload.accounts;

        if (payload.accounts.length > 0) {
          state.defaultAccount = payload.accounts[0];
        }
        else {
          state.defaultAccount = null;
        }
      },

      setContracts(state: IState, payload) {
        state.contracts = payload;
      },

      updateSkillBalance(state: IState, { skillBalance }) {
        state.skillBalance = skillBalance;
      },

      updateUserDetails(state: IState, payload) {
        const keysToAllow = ['ownedCharacterIds', 'ownedWeaponIds', 'maxStamina'];
        for (const key of keysToAllow) {
          if (Object.hasOwnProperty.call(payload, key)) {
            Vue.set(state, key, payload[key]);
          }
        }

        if (state.ownedCharacterIds.length > 0 &&
          (
            !state.currentCharacterId ||
            !state.ownedCharacterIds.includes(state.currentCharacterId)
          )
        ) {
          state.currentCharacterId = state.ownedCharacterIds[0];
        }
        else if (state.ownedCharacterIds.length === 0) {
          state.currentCharacterId = null;
        }
      },

      setCurrentCharacter(state: IState, characterId: number) {
        state.currentCharacterId = characterId;
      },

      addNewOwnedCharacterId(state: IState, characterId: number) {
        if (!state.ownedCharacterIds.includes(characterId)) {
          state.ownedCharacterIds.push(characterId);
        }
      },

      addNewOwnedWeaponId(state: IState, weaponId: number) {
        if (!state.ownedWeaponIds.includes(weaponId)) {
          state.ownedWeaponIds.push(weaponId);
        }
      },

      updateCharacter(state: IState, { characterId, character }) {
        Vue.set(state.characters, characterId, character);
      },

      updateWeapon(state: IState, { weaponId, weapon }) {
        Vue.set(state.weapons, weaponId, weapon);
      },

      updateCharacterStamina(state: IState, { characterId, stamina }) {
        Vue.set(state.characterStaminas, characterId, stamina);
      },

      updateTargets(state: IState, { characterId, weaponId, targets }) {
        if (!state.targetsByCharacterIdAndWeaponId[characterId]) {
          Vue.set(state.targetsByCharacterIdAndWeaponId, characterId, {});
        }

        Vue.set(state.targetsByCharacterIdAndWeaponId[characterId], weaponId, targets);
      },

      updateStakeData(state: IState, { stakeType, ...payload }: { stakeType: StakeType } & IStakeState) {
        Vue.set(state.staking, stakeType, payload);
      },

      updateStakeOverviewDataPartial(state, payload: { stakeType: StakeType } & IStakeOverviewState) {
        const { stakeType, ...data } = payload;
        Vue.set(state.stakeOverviews, stakeType, data);
      },

      updateRaidData(state, payload: RaidData) {
        state.raid.expectedFinishTime = payload.expectedFinishTime;
        state.raid.raiderCount = payload.raiderCount;
        state.raid.bounty = payload.bounty;
        state.raid.totalPower = payload.totalPower;
        state.raid.weaponDrops = payload.weaponDrops;
        state.raid.staminaDrainSeconds = payload.staminaDrainSeconds;
      },

      updateAllIsOwnedCharacterRaidingById(state, payload: Record<number, boolean>) {
        state.raid.isOwnedCharacterRaidingById = payload;
      }
    },

    actions: {
      async initialize({ dispatch }) {
        await dispatch('setUpContracts');
        await dispatch('setUpContractEvents');

        await dispatch('pollAccountsAndNetwork');
      },

      async pollAccountsAndNetwork({ state, dispatch, commit }) {
        let refreshUserDetails = false;
        const networkId = await web3.eth.net.getId();

        if(state.currentNetworkId !== networkId) {
          commit('setNetworkId', networkId);
          refreshUserDetails = true;
        }

        const accounts = await web3.eth.requestAccounts();

        if (!_.isEqual(state.accounts, accounts)) {
          commit('setAccounts', { accounts });
          refreshUserDetails = true;
        }

        if(refreshUserDetails) {
          await dispatch('fetchUserDetails');
        }
      },

      setUpContractEvents({ state, dispatch, commit }) {
        if (!featureFlagStakeOnly) {
          // TODO filter to only get own
          state.contracts.Characters!.events.NewCharacter(async (err: Error, data: any) => {
            if (err) {
              console.error(err);
              return;
            }

            console.log('NewCharacter', data);

            const characterId = data.returnValues.character;

            commit('addNewOwnedCharacterId', characterId);

            await Promise.all([
              dispatch('fetchCharacter', characterId),
              dispatch('fetchSkillBalance')
            ]);
          });

          // TODO filter to only get own
          state.contracts.Weapons!.events.NewWeapon(async (err: Error, data: any) => {
            if (err) {
              console.error(err);
              return;
            }

            console.log('NewWeapon', data);

            const weaponId = data.returnValues.weapon;

            commit('addNewOwnedWeaponId', weaponId);

            await Promise.all([
              dispatch('fetchWeapon', weaponId),
              dispatch('fetchSkillBalance')
            ]);
          });

          // TODO filter to only get own
          state.contracts.CryptoBlades!.events.FightOutcome(async (err: Error, data: any) => {
            if (err) {
              console.error(err);
              return;
            }

            console.log('FightOutcome', data);

            await Promise.all([
              dispatch('fetchCharacter', data.returnValues.character),
              dispatch('fetchSkillBalance')
            ]);
          });
        }

        function setupStakingEvents(stakeType: StakeType, StakingRewards: StakingRewardsAlias) {
          StakingRewards.events.RewardPaid({ filter: { user: state.defaultAccount } }, async (err: Error, data: any) => {
            if (err) {
              console.error(err);
              return;
            }

            console.log('RewardPaid', data);

            await dispatch('fetchStakeDetails', { stakeType });
          });

          StakingRewards.events.RewardAdded(async (err: Error, data: any) => {
            if (err) {
              console.error(err);
              return;
            }

            console.log('RewardAdded', data);

            await dispatch('fetchStakeDetails', { stakeType });
          });

          StakingRewards.events.RewardsDurationUpdated(async (err: Error, data: any) => {
            if (err) {
              console.error(err);
              return;
            }

            console.log('RewardsDurationUpdated', data);

            await dispatch('fetchStakeDetails', { stakeType });
          });
        }

        setupStakingEvents('skill', state.contracts.SkillStakingRewards);
        setupStakingEvents('lp', state.contracts.LPStakingRewards);
        setupStakingEvents('lp2', state.contracts.LP2StakingRewards);
      },

      async setUpContracts({ commit }) {
        const contracts = await setUpContracts(web3, featureFlagStakeOnly);
        commit('setContracts', contracts);
      },

      async fetchUserDetails({ dispatch }) {
        const promises = [dispatch('fetchSkillBalance')];

        if (!featureFlagStakeOnly) {
          promises.push(dispatch('fetchUserGameDetails'));
        }

        await Promise.all([promises]);
      },

      async fetchUserGameDetails({ state, dispatch, commit }) {
        if(featureFlagStakeOnly) return;

        const [
          ownedCharacterIds,
          ownedWeaponIds,
          maxStamina,
        ] = await Promise.all([
          state.contracts.CryptoBlades!.methods.getMyCharacters().call(defaultCallOptions(state)),
          state.contracts.CryptoBlades!.methods.getMyWeapons().call(defaultCallOptions(state)),
          state.contracts.Characters!.methods.maxStamina().call(defaultCallOptions(state)),
        ]);

        commit('updateUserDetails', {
          ownedCharacterIds: Array.from(ownedCharacterIds),
          ownedWeaponIds: Array.from(ownedWeaponIds),
          maxStamina: parseInt(maxStamina, 10)
        });

        await Promise.all([
          dispatch('fetchCharacters', ownedCharacterIds),
          dispatch('fetchWeapons', ownedWeaponIds),
        ]);
      },

      async updateWeaponIds({ state, dispatch, commit }) {
        if(featureFlagStakeOnly) return;

        const ownedWeaponIds = await state.contracts.CryptoBlades!.methods.getMyWeapons().call(defaultCallOptions(state));
        commit('updateUserDetails', {
          ownedWeaponIds: Array.from(ownedWeaponIds)
        });
        await dispatch('fetchWeapons', ownedWeaponIds);
      },

      async fetchSkillBalance({ state, commit }) {
        if(!state.defaultAccount) return;

        const skillBalance = await state.contracts.SkillToken.methods
          .balanceOf(state.defaultAccount)
          .call(defaultCallOptions(state));

        if(state.skillBalance !== skillBalance) {
          commit('updateSkillBalance', { skillBalance });
        }
      },

      async addMoreSkill({ state, dispatch }, skillToAdd: string) {
        if(featureFlagStakeOnly) return;

        await state.contracts.CryptoBlades!.methods.giveMeSkill(skillToAdd).send({
          from: state.defaultAccount,
        });

        await dispatch('fetchSkillBalance');
      },

      async fetchCharacters({ dispatch }, characterIds: number[]) {
        await Promise.all(characterIds.map((id: number) => dispatch('fetchCharacter', id)));

        await dispatch('fetchOwnedCharacterRaidStatus');
      },

      async fetchCharacter({ state, commit }, characterId: number) {
        if(featureFlagStakeOnly) return;

        const character = characterFromContract(
          characterId,
          await state.contracts.Characters!.methods.get('' + characterId).call(defaultCallOptions(state))
        );

        commit('updateCharacter', { characterId, character });
      },

      async fetchWeapons({ dispatch }, weaponIds: number[]) {
        await Promise.all(weaponIds.map((id: number) => dispatch('fetchWeapon', id)));
      },

      async fetchWeapon({ state, commit }, weaponId: number) {
        if(featureFlagStakeOnly) return;

        const weapon = weaponFromContract(
          weaponId,
          await state.contracts.Weapons!.methods.get('' + weaponId).call(defaultCallOptions(state))
        );

        commit('updateWeapon', { weaponId, weapon });
      },

      async fetchCharacterStamina({ state, commit }, characterId: number) {
        if(featureFlagStakeOnly) return;

        const staminaString = await state.contracts.Characters!.methods
          .getStaminaPoints('' + characterId)
          .call(defaultCallOptions(state));

        const stamina = parseInt(staminaString, 10);
        if (state.characterStaminas[characterId] !== stamina) {
          commit('updateCharacterStamina', { characterId, stamina });
        }
      },

      async mintCharacter({ state }) {
        if(featureFlagStakeOnly) return;

        await state.contracts.CryptoBlades!.methods.mintCharacter().send({
          from: state.defaultAccount,
        });
      },

      async mintWeapon({ state }) {
        if(featureFlagStakeOnly) return;

        await state.contracts.CryptoBlades!.methods.mintWeapon().send({
          from: state.defaultAccount,
        });
      },

      async reforgeWeapon({ state, dispatch }, { burnWeaponId, reforgeWeaponId }) {
        if(featureFlagStakeOnly) return;

        await state.contracts.Weapons!.methods
          .approve(
            state.contracts.CryptoBlades!.options.address,
            burnWeaponId
          )
          .send({
            from: state.defaultAccount,
          });

        await state.contracts.CryptoBlades!.methods
          .reforgeWeapon(
            reforgeWeaponId,
            burnWeaponId
          )
          .send({
            from: state.defaultAccount,
          });

        await dispatch('updateWeaponIds');
      },

      async fetchTargets({ state, commit }, { characterId, weaponId }) {
        if(featureFlagStakeOnly) return;

        if (!characterId || !weaponId) {
          commit('updateTargets', { characterId, weaponId, targets: [] });
          return;
        }

        const targets = await state.contracts.CryptoBlades!.methods
          .getTargets(characterId, weaponId)
          .call(defaultCallOptions(state));

        commit('updateTargets', { characterId, weaponId, targets: targets.map(targetFromContract) });
      },

      async doEncounter({ state, dispatch }, { characterId, weaponId, targetString }) {
        if(featureFlagStakeOnly) return;

        const res = await state.contracts.CryptoBlades!.methods
          .fight(
            characterId,
            weaponId,
            targetString
          )
          .send({ from: state.defaultAccount });

        await dispatch('fetchTargets', { characterId, weaponId });

        const {
          playerRoll,
          enemyRoll,
        } = res.events.FightOutcome.returnValues;

        if (parseInt(playerRoll, 10) >= parseInt(enemyRoll, 10)) {
          return true;
        } else {
          return false;
        }
      },

      async fetchStakeOverviewData({ dispatch }) {
        await Promise.all(
          allStakeTypes
            .map(stakeType =>
              dispatch('fetchStakeOverviewDataPartial', { stakeType })
            )
        );
      },

      async fetchStakeOverviewDataPartial({ state, commit }, { stakeType }: { stakeType: StakeType }) {
        const { StakingRewards } = getStakingContracts(state.contracts, stakeType);

        const [
          rewardRate,
          rewardsDuration,
          totalSupply,
          minimumStakeTime,
        ] = await Promise.all([
          StakingRewards.methods.rewardRate().call(defaultCallOptions(state)),
          StakingRewards.methods.rewardsDuration().call(defaultCallOptions(state)),
          StakingRewards.methods.totalSupply().call(defaultCallOptions(state)),
          StakingRewards.methods.minimumStakeTime().call(defaultCallOptions(state)),
        ]);

        const stakeSkillOverviewData: IStakeOverviewState = {
          rewardRate,
          rewardsDuration: parseInt(rewardsDuration, 10),
          totalSupply,
          minimumStakeTime: parseInt(minimumStakeTime, 10),
        };
        commit('updateStakeOverviewDataPartial', { stakeType, ...stakeSkillOverviewData });
      },

      async fetchStakeDetails({ state, commit }, { stakeType }: { stakeType: StakeType }) {
        if(!state.defaultAccount) return;

        const { StakingRewards, StakingToken } = getStakingContracts(state.contracts, stakeType);

        const [
          ownBalance,
          stakedBalance,
          remainingCapacityForDeposit,
          remainingCapacityForWithdraw,
          contractBalance,
          currentRewardEarned,
          rewardMinimumStakeTime,
          rewardDistributionTimeLeft,
          unlockTimeLeft
        ] = await Promise.all([
          StakingToken.methods.balanceOf(state.defaultAccount).call(defaultCallOptions(state)),
          StakingRewards.methods.balanceOf(state.defaultAccount).call(defaultCallOptions(state)),
          Promise.resolve(null as string | null),
          StakingRewards.methods.totalSupply().call(defaultCallOptions(state)),
          StakingToken.methods.balanceOf(StakingRewards.options.address).call(defaultCallOptions(state)),
          StakingRewards.methods.earned(state.defaultAccount).call(defaultCallOptions(state)),
          StakingRewards.methods.minimumStakeTime().call(defaultCallOptions(state)),
          StakingRewards.methods.getStakeRewardDistributionTimeLeft().call(defaultCallOptions(state)),
          StakingRewards.methods.getStakeUnlockTimeLeft().call(defaultCallOptions(state)),
        ]);

        console.log('fetched data for', stakeType, StakingRewards.options.address, StakingToken.options.address);

        const stakeData: { stakeType: StakeType } & IStakeState = {
          stakeType,
          ownBalance,
          stakedBalance,
          remainingCapacityForDeposit,
          remainingCapacityForWithdraw,
          contractBalance,
          currentRewardEarned,
          rewardMinimumStakeTime: parseInt(rewardMinimumStakeTime, 10),
          rewardDistributionTimeLeft: parseInt(rewardDistributionTimeLeft, 10),
          unlockTimeLeft: parseInt(unlockTimeLeft, 10)
        };
        commit('updateStakeData', stakeData);
      },

      async stake({ state, dispatch }, { amount, stakeType }: { amount: string, stakeType: StakeType }) {
        const { StakingRewards, StakingToken } = getStakingContracts(state.contracts, stakeType);

        await StakingToken.methods.approve(StakingRewards.options.address, amount).send({
          from: state.defaultAccount
        });

        await StakingRewards.methods.stake(amount).send({
          from: state.defaultAccount,
        });

        await dispatch('fetchStakeDetails', { stakeType });
      },

      async unstake({ state, dispatch }, { amount, stakeType }: { amount: string, stakeType: StakeType }) {
        const { StakingRewards } = getStakingContracts(state.contracts, stakeType);

        await StakingRewards.methods.withdraw(amount).send({
          from: state.defaultAccount,
        });

        await dispatch('fetchStakeDetails', { stakeType });
      },

      async claimReward({ state, dispatch }, { stakeType }: { stakeType: StakeType }) {
        const { StakingRewards } = getStakingContracts(state.contracts, stakeType);

        await StakingRewards.methods.getReward().send({
          from: state.defaultAccount,
        });

        await dispatch('fetchStakeDetails', { stakeType });
      },

      async fetchRaidData({ state, commit }) {
        if(featureFlagStakeOnly) return;

        const RaidBasic = state.contracts.RaidBasic!;

        const [
          expectedFinishTime,
          raiderCount,
          bounty,
          totalPower,
          weaponDrops,
          staminaDrainSeconds
        ] = await Promise.all([
          RaidBasic.methods.getExpectedFinishTime().call(defaultCallOptions(state)),
          RaidBasic.methods.getRaiderCount().call(defaultCallOptions(state)),
          RaidBasic.methods.getBounty().call(defaultCallOptions(state)),
          RaidBasic.methods.getTotalPower().call(defaultCallOptions(state)),
          RaidBasic.methods.getWeaponDrops().call(defaultCallOptions(state)),
          RaidBasic.methods.getStaminaDrainSeconds().call(defaultCallOptions(state)),
        ]);

        const raidData: RaidData = {
          expectedFinishTime,
          raiderCount: parseInt(raiderCount, 10),
          bounty,
          totalPower,
          weaponDrops,
          staminaDrainSeconds: parseInt(staminaDrainSeconds, 10)
        };
        commit('updateRaidData', raidData);
      },

      async fetchOwnedCharacterRaidStatus({ state, commit }) {
        if(featureFlagStakeOnly) return;

        const RaidBasic = state.contracts.RaidBasic!;

        const ownedCharacterIds = _.clone(state.ownedCharacterIds);
        const characterIsRaidingRes = await Promise.all(
          ownedCharacterIds.map(
            cid => RaidBasic.methods.isRaider('' + cid).call(defaultCallOptions(state))
          )
        );
        const isOwnedCharacterRaiding: Record<number, boolean> = _.fromPairs(
          _.zip(ownedCharacterIds, characterIsRaidingRes)
        );

        commit('updateAllIsOwnedCharacterRaidingById', isOwnedCharacterRaiding);
      }
    }
  });
}
