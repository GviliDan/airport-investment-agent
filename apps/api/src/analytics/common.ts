/** An input an analysis wanted but did not have. Missing inputs are reported, never replaced by zero. */
export interface MissingInput {
  readonly input: string;
  readonly reason: string;
}
