export function resolveNpmCliInvocation(
  args,
  environment = process.env,
  nodeExecutable = process.execPath,
) {
  const npmExecPath = environment.npm_execpath;
  if (
    typeof npmExecPath !== 'string'
    || !/[\\/]npm-cli\.js$/i.test(npmExecPath)
    || /[\r\n\0]/.test(npmExecPath)
  ) {
    throw new Error('The npm JavaScript entry path is unavailable or invalid.');
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new Error('npm arguments must be explicit strings.');
  }
  return { executable: nodeExecutable, args: [npmExecPath, ...args] };
}
