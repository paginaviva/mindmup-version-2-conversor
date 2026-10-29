/**
 * @module paths
 * R2 key templates shared by the converter entry point and the Durable Object.
 *
 * Anonymous conversions use the temporary templates from the behaviour
 * variables; every other mode, including `catalogue`, uses the catalogue
 * templates. Templates are always injected by the caller, so this module does
 * not hardcode keys or prefixes.
 */

/**
 * Resolves the R2 key templates for a conversion mode.
 *
 * @param {string} mode - Conversion mode: `anonymous` or `catalogue`.
 * @param {Object} variables - Behaviour variables loaded from VARIABLES_KV.
 * @param {string} variables.R2_TEMP_INPUT_PATH_TEMPLATE - Temporary input key template.
 * @param {string} variables.R2_TEMP_OUTPUT_PATH_TEMPLATE - Temporary output key template.
 * @param {string} variables.R2_INPUT_PATH_TEMPLATE - Catalogue input key template.
 * @param {string} variables.R2_OUTPUT_PATH_TEMPLATE - Catalogue output key template.
 * @returns {{inputTemplate: string, outputTemplate: string}} Resolved templates.
 */
export function resolvePathTemplates(mode, variables) {
  if (mode === 'anonymous') {
    return {
      inputTemplate: variables.R2_TEMP_INPUT_PATH_TEMPLATE,
      outputTemplate: variables.R2_TEMP_OUTPUT_PATH_TEMPLATE,
    };
  }

  return {
    inputTemplate: variables.R2_INPUT_PATH_TEMPLATE,
    outputTemplate: variables.R2_OUTPUT_PATH_TEMPLATE,
  };
}
