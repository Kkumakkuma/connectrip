import { describe, it, expect } from 'vitest';
import { isMissingRpcError } from './profileLoad';

describe('isMissingRpcError', () => {
  it('함수가 없을 때만 폴백 허용', () => {
    expect(isMissingRpcError({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true);
    expect(isMissingRpcError({ code: '42883' })).toBe(true);
    expect(isMissingRpcError({ message: 'Could not find the function public.get_my_profile without parameters' })).toBe(true);
  });
  it('네트워크·권한·기타 오류는 폴백하지 않는다', () => {
    expect(isMissingRpcError({ code: '' , message: 'TypeError: Failed to fetch' })).toBe(false);
    expect(isMissingRpcError({ code: '42501' })).toBe(false);
    expect(isMissingRpcError({ code: '42501', message: 'Could not find the function' })).toBe(false);
    expect(isMissingRpcError({ code: 'PGRST116' })).toBe(false);
    expect(isMissingRpcError({})).toBe(false);
    expect(isMissingRpcError(null)).toBe(false);
    expect(isMissingRpcError(undefined)).toBe(false);
  });
});
