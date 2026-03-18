import { test, expect, describe } from 'bun:test'
import {
  SAFE_TOOLS,
  SAFE_BASH_PATTERNS,
  DANGEROUS_COMMANDS,
  hasDangerousStructure,
  isSafeBashCommand,
  isDangerousCommand,
} from './permission-rules'

describe('permission-rules 常量', () => {
  test('SAFE_TOOLS 包含预期的安全工具', () => {
    expect(SAFE_TOOLS).toContain('Read')
    expect(SAFE_TOOLS).toContain('Glob')
    expect(SAFE_TOOLS).toContain('Grep')
    expect(SAFE_TOOLS).toContain('WebSearch')
    expect(SAFE_TOOLS).toContain('TodoRead')
    expect(SAFE_TOOLS).toContain('TodoWrite')
  })

  test('SAFE_TOOLS 不包含写操作工具', () => {
    expect(SAFE_TOOLS).not.toContain('Write')
    expect(SAFE_TOOLS).not.toContain('Edit')
    expect(SAFE_TOOLS).not.toContain('Bash')
  })

  test('SAFE_BASH_PATTERNS 为非空正则数组', () => {
    expect(SAFE_BASH_PATTERNS.length).toBeGreaterThan(0)
    for (const pattern of SAFE_BASH_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp)
    }
  })

  test('DANGEROUS_COMMANDS 包含常见危险命令', () => {
    expect(DANGEROUS_COMMANDS).toContain('rm')
    expect(DANGEROUS_COMMANDS).toContain('sudo')
    expect(DANGEROUS_COMMANDS).toContain('chmod')
    expect(DANGEROUS_COMMANDS).toContain('git push')
    expect(DANGEROUS_COMMANDS).toContain('npm publish')
  })
})

describe('hasDangerousStructure', () => {
  test('检测管道操作', () => {
    expect(hasDangerousStructure('cat file.txt | grep test')).toBe(true)
  })

  test('检测输出重定向', () => {
    expect(hasDangerousStructure('echo hello > file.txt')).toBe(true)
    expect(hasDangerousStructure('echo hello >> file.txt')).toBe(true)
  })

  test('检测 find -exec', () => {
    expect(hasDangerousStructure('find . -name "*.tmp" -exec rm {} ;')).toBe(true)
  })

  test('检测 find -delete', () => {
    expect(hasDangerousStructure('find . -name "*.tmp" -delete')).toBe(true)
  })

  test('检测 find -exec（修复后）', () => {
    expect(hasDangerousStructure('find . -name "*.log" -exec rm {} +')).toBe(true)
  })

  test('检测命令链接符 &&', () => {
    expect(hasDangerousStructure('cd /tmp && rm -rf *')).toBe(true)
  })

  test('检测命令链接符 ;', () => {
    expect(hasDangerousStructure('echo hello; rm -rf /')).toBe(true)
  })

  test('检测子 shell $(...)', () => {
    expect(hasDangerousStructure('echo $(cat /etc/passwd)')).toBe(true)
  })

  test('检测反引号命令替换', () => {
    expect(hasDangerousStructure('echo `cat /etc/passwd`')).toBe(true)
  })

  test('简单安全命令返回 false', () => {
    expect(hasDangerousStructure('ls -la')).toBe(false)
    expect(hasDangerousStructure('git status')).toBe(false)
    expect(hasDangerousStructure('pwd')).toBe(false)
  })
})

describe('isSafeBashCommand', () => {
  // --- 安全命令 ---
  test('git status 是安全命令', () => {
    expect(isSafeBashCommand('git status')).toBe(true)
  })

  test('git log --oneline 是安全命令', () => {
    expect(isSafeBashCommand('git log --oneline')).toBe(true)
  })

  test('git diff HEAD 是安全命令', () => {
    expect(isSafeBashCommand('git diff HEAD')).toBe(true)
  })

  test('ls -la 是安全命令', () => {
    expect(isSafeBashCommand('ls -la')).toBe(true)
  })

  test('pwd 是安全命令', () => {
    expect(isSafeBashCommand('pwd')).toBe(true)
  })

  test('whoami 是安全命令', () => {
    expect(isSafeBashCommand('whoami')).toBe(true)
  })

  test('head -n 10 file.txt 是安全命令', () => {
    expect(isSafeBashCommand('head -n 10 file.txt')).toBe(true)
  })

  test('grep -r pattern . 是安全命令', () => {
    expect(isSafeBashCommand('grep -r pattern .')).toBe(true)
  })

  test('node --version 是安全命令', () => {
    expect(isSafeBashCommand('node --version')).toBe(true)
  })

  test('bun --version 是安全命令', () => {
    expect(isSafeBashCommand('bun --version')).toBe(true)
  })

  test('wc -l file.txt 是安全命令', () => {
    expect(isSafeBashCommand('wc -l file.txt')).toBe(true)
  })

  // --- 非安全命令 ---
  test('rm -rf 不是安全命令', () => {
    expect(isSafeBashCommand('rm -rf /tmp')).toBe(false)
  })

  test('cat 不是安全命令（可读敏感文件）', () => {
    expect(isSafeBashCommand('cat /etc/passwd')).toBe(false)
  })

  test('echo 不是安全命令（可重定向写入）', () => {
    expect(isSafeBashCommand('echo hello')).toBe(false)
  })

  test('包含管道的命令不安全', () => {
    expect(isSafeBashCommand('git log | head')).toBe(false)
  })

  test('包含重定向的命令不安全', () => {
    expect(isSafeBashCommand('git status > output.txt')).toBe(false)
  })

  test('前后空格会被修剪', () => {
    expect(isSafeBashCommand('  git status  ')).toBe(true)
  })
})

describe('isDangerousCommand', () => {
  test('rm 是危险命令', () => {
    expect(isDangerousCommand('rm -rf /')).toBe(true)
  })

  test('sudo 是危险命令', () => {
    expect(isDangerousCommand('sudo apt install')).toBe(true)
  })

  test('git push 是危险命令', () => {
    expect(isDangerousCommand('git push origin main')).toBe(true)
  })

  test('git reset 是危险命令', () => {
    expect(isDangerousCommand('git reset --hard')).toBe(true)
  })

  test('npm publish 是危险命令', () => {
    expect(isDangerousCommand('npm publish')).toBe(true)
  })

  test('chmod 是危险命令', () => {
    expect(isDangerousCommand('chmod 777 file')).toBe(true)
  })

  test('curl 是危险命令', () => {
    expect(isDangerousCommand('curl http://example.com')).toBe(true)
  })

  test('kill 是危险命令', () => {
    expect(isDangerousCommand('kill -9 1234')).toBe(true)
  })

  test('大小写不敏感', () => {
    expect(isDangerousCommand('RM -rf /')).toBe(true)
    expect(isDangerousCommand('SUDO apt install')).toBe(true)
  })

  test('前后空格会被修剪', () => {
    expect(isDangerousCommand('  rm -rf /  ')).toBe(true)
  })

  test('安全命令返回 false', () => {
    expect(isDangerousCommand('ls -la')).toBe(false)
    expect(isDangerousCommand('git status')).toBe(false)
    expect(isDangerousCommand('pwd')).toBe(false)
    expect(isDangerousCommand('echo hello')).toBe(false)
  })
})
