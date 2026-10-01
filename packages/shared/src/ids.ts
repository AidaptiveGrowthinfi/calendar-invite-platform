/**
 * Branded identifier types.
 *
 * `OrganisationId` is the one that matters. ADR 0043 makes `organisation.id`
 * the value that reaches `app.organisation_id`, and slice 1 is explicit that it
 * is NOT the Better Auth organisation id. The brand exists so that passing the
 * wrong one to `withOrg()` is a compile error rather than a silent empty
 * result set.
 */
import { z } from 'zod';

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type OrganisationId = Brand<string, 'OrganisationId'>;
export type AuthOrganizationId = Brand<string, 'AuthOrganizationId'>;
export type UserId = Brand<string, 'UserId'>;
export type RequestId = Brand<string, 'RequestId'>;

const uuid = z.string().uuid();

export const organisationId = uuid.transform((v) => v as OrganisationId);
export const userId = uuid.transform((v) => v as UserId);

/** Better Auth ids are library-generated text, not uuids (slice 1). */
export const authOrganizationId = z
  .string()
  .min(1)
  .transform((v) => v as AuthOrganizationId);

export const requestId = z
  .string()
  .min(1)
  .transform((v) => v as RequestId);

/** Unsafe casts, for boundaries where the value is already known to be valid. */
export const asOrganisationId = (v: string): OrganisationId => organisationId.parse(v);
export const asRequestId = (v: string): RequestId => v as RequestId;
