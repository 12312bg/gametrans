# 用 Ruby 读取回写后的文件，打印所有字符串，验证 Ruby/RGSS 可以正常加载。
# 用法：ruby verify.rb <file>
require 'zlib'
require_relative 'rgss_classes'

def walk(o, out, seen = {})
  return if seen[o.object_id] && !o.is_a?(String)
  seen[o.object_id] = true
  case o
  when String then out << o.dup.force_encoding('UTF-8')
  when Array then o.each { |x| walk(x, out, seen) }
  when Hash then o.each { |k, v| walk(k, out, seen); walk(v, out, seen) }
  when Integer, Float, Symbol, NilClass, TrueClass, FalseClass then nil
  else o.instance_variables.each { |iv| walk(o.instance_variable_get(iv), out, seen) }
  end
end

obj = Marshal.load(File.binread(ARGV[0]))
out = []
if File.basename(ARGV[0]).start_with?('Scripts')
  obj.each { |_, name, code| out << name.dup.force_encoding('UTF-8'); out << Zlib::Inflate.inflate(code).force_encoding('UTF-8') }
else
  walk(obj, out)
end
puts out.reject(&:empty?)
