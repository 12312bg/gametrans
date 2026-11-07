# 生成 XP / VX / VX Ace 测试数据（模拟 RGSS 的 RPG:: 类结构）。
# 用法：ruby gen.rb <输出目录>
# XP/VX 基于 Ruby 1.8，字符串无编码标记；为模拟这一点，XP/VX 的字符串强制为二进制编码。
require 'zlib'
require 'fileutils'

OUT = ARGV[0] || File.join(__dir__, 'rgss')
require_relative 'rgss_classes'

def cmd(code, indent, params) RPG::EventCommand.new(code, indent, params) end

def set_ivars(obj, h)
  h.each { |k, v| obj.instance_variable_set("@#{k}", v) }
  obj
end

def dump(name, obj)
  FileUtils.mkdir_p(OUT)
  File.binwrite(File.join(OUT, name), Marshal.dump(obj))
end

def event_list(engine)
  shared = s('共有された文字列')
  list = []
  if engine == :xp
    list << cmd(101, 0, [s('こんにちは、旅の人。')])
    list << cmd(401, 0, [s('この村へようこそ！')])
  else
    list << cmd(101, 0, [s('Actor1'), 0, 0, 2])
    list << cmd(401, 0, [s('こんにちは、旅の人。')])
    list << cmd(401, 0, [s('\\C[2]この村\\C[0]へようこそ！')])
  end
  list << cmd(102, 0, [[s('はい'), s('いいえ')], 2])
  list << cmd(402, 0, [0, s('はい')])
  if engine == :xp
    list << cmd(101, 1, [s('ありがとう！')])
  else
    list << cmd(101, 1, [s(''), 0, 0, 2])
    list << cmd(401, 1, [s('ありがとう！')])
  end
  list << cmd(0, 1, [])
  list << cmd(402, 0, [1, s('いいえ')])
  list << cmd(0, 1, [])
  list << cmd(404, 0, [])
  list << cmd(108, 0, [s('開発者コメント')])
  list << cmd(355, 0, [s('$game_variables[1] = "スクリプト"')])
  list << cmd(655, 0, [s('p 1')])
  list << cmd(320, 0, [1, s('アレックス')])
  list << cmd(122, 0, [1, 1, 0, 0, 2**30 - 1])
  list << cmd(122, 0, [2, 2, 0, 0, 2**30])
  list << cmd(122, 0, [3, 3, 0, 0, -70000])
  list << cmd(250, 0, [RPG::SE.new('Bell1', 80, 100)])
  list << cmd(223, 0, [Tone.new(-34, -34, 0, 170), 60, true])
  list << cmd(205, 0, [-1, RPG::MoveRoute.new])
  list << cmd(117, 0, [shared])
  list << cmd(117, 0, [shared])
  if engine == :ace
    list << cmd(105, 0, [2, false])
    list << cmd(405, 0, [s('遠い昔……')])
    list << cmd(405, 0, [s('ある王国があった。')])
  end
  list << cmd(0, 0, [])
  list
end

def build(engine)
  $legacy = engine != :ace
  ext = { xp: 'rxdata', vx: 'rvdata', ace: 'rvdata2' }[engine]

  map = RPG::Map.new(4, 3)
  map.display_name = s('はじまりの村') if engine == :ace
  map.note = s('<note tag>') if engine == :ace
  ev = RPG::Event.new(3, 4)
  ev.id = 1
  ev.name = s('村人A')
  ev.pages[0].list = event_list(engine)
  page2 = RPG::Event::Page.new
  page2.list = [cmd(101, 0, engine == :xp ? [s('また来てね。')] : [s('Actor2'), 1, 0, 2]),
                *(engine == :xp ? [] : [cmd(401, 0, [s('また来てね。')])]),
                cmd(0, 0, [])]
  ev.pages << page2
  map.events[1] = ev
  ev2 = RPG::Event.new(1, 1)
  ev2.id = 5
  ev2.name = s('看板')
  ev2.pages[0].list = [cmd(0, 0, [])]
  map.events[5] = ev2
  dump("Map001.#{ext}", map)

  dump("CommonEvents.#{ext}", [nil, RPG::CommonEvent.new(1, '共通', [
    cmd(engine == :xp ? 101 : 101, 0, engine == :xp ? [s('共通イベントの台詞')] : [s(''), 0, 0, 2]),
    *(engine == :xp ? [] : [cmd(401, 0, [s('共通イベントの台詞')])]),
    cmd(0, 0, [])
  ])])

  dump("Troops.#{ext}", [nil, RPG::Troop.new(1, 'スライム*2', [RPG::Troop::Page.new([
    cmd(101, 0, engine == :xp ? [s('スライムが現れた！')] : [s(''), 0, 0, 2]),
    *(engine == :xp ? [] : [cmd(401, 0, [s('スライムが現れた！')])]),
    cmd(0, 0, [])
  ])])])

  actor = set_ivars(RPG::Actor.new, id: 1, name: s('エリック'), class_id: 1, initial_level: 1)
  if engine == :ace
    set_ivars(actor, nickname: s('若き勇者'), description: s("勇敢な少年。\n剣が得意。"), note: s(''),
                     features: [RPG::BaseItem::Feature.new(23, 0, 1.0), RPG::BaseItem::Feature.new(22, 1, 0.05)])
  end
  dump("Actors.#{ext}", [nil, actor, set_ivars(RPG::Actor.new, id: 2, name: s(''), class_id: 1)])

  item = set_ivars(RPG::Item.new, id: 1, name: s('ポーション'), description: s('HPを500回復する。'), price: 50,
                   icon_name: s('Potion'))
  item.instance_variable_set(:@note, s("<Help:薬>\n")) if engine == :ace
  dump("Items.#{ext}", [nil, item])

  skill = set_ivars(RPG::Skill.new, id: 1, name: s('ファイア'), description: s('炎で攻撃する。'))
  set_ivars(skill, message1: s('は炎を放った！'), message2: s('')) unless engine == :xp
  dump("Skills.#{ext}", [nil, skill])

  state = set_ivars(RPG::State.new, id: 1, name: s('戦闘不能'))
  set_ivars(state, message1: s('は倒れた！'), message2: s('を倒した！'), message3: s(''), message4: s('は立ち上がった！')) unless engine == :xp
  dump("States.#{ext}", [nil, state])

  sys = RPG::System.new
  case engine
  when :xp
    words = set_ivars(RPG::System::Words.new, gold: s('G'), hp: s('HP'), sp: s('SP'), attack: s('攻撃'),
                                             skill: s('スキル'), guard: s('防御'), item: s('アイテム'), equip: s('装備'))
    set_ivars(sys, magic_number: 123456, party_members: [1], elements: [s(''), s('炎'), s('氷')], words: words,
                   windowskin_name: s('001-Blue01'), title_bgm: RPG::BGM.new('062-Slow05'))
  when :vx
    terms = set_ivars(RPG::System::Terms.new, level: s('レベル'), hp: s('HP'), mp: s('MP'), attack: s('攻撃'),
                                             gold: s('G'), new_game: s('ニューゲーム'), continue: s('コンティニュー'))
    set_ivars(sys, game_title: s('テストゲーム'), elements: [s(''), s('炎')], terms: terms, version_id: 987654321,
                   battler_hue: 0)
  when :ace
    terms = set_ivars(RPG::System::Terms.new, basic: [s('レベル'), s('Lv'), s('HP'), s('HP')],
                                             params: [s('最大HP'), s('最大MP')], etypes: [s('武器'), s('盾')],
                                             commands: [s('戦う'), s('逃げる'), nil, s('攻撃')])
    set_ivars(sys, game_title: s('テストゲーム'), currency_unit: s('G'), elements: [nil, s('物理'), s('炎')],
                   skill_types: [nil, s('魔法')], weapon_types: [nil, s('剣')], armor_types: [nil, s('一般防具')],
                   terms: terms, window_tone: Tone.new(0, 0, 0), version_id: 2**40, japanese: true,
                   opt_meta: { s('k') => :sym_value, :sym_key => 1.5 }, hash_default: Hash.new(0).merge(1 => 2))
  end
  dump("System.#{ext}", sys)

  script_code = <<~'RUBY'
    #==========================================================================
    # ■ Vocab
    #==========================================================================
    module Vocab
      # ショップ画面
      ShopBuy         = "購入する"
      ShopSell        = '売却する'
      Possession      = "持っている数"
      ActorDamage     = "%sは %s のダメージを受けた！"
      Escape          = "#{$data_system ? "x" : 'y'}は逃げ出した！"
      Quote           = "彼は\"こんにちは\"と言った"
      def self.basic(basic_id)
        $data_system.terms.basic[basic_id] # 'not a string'
      end
    end
    =begin
    "this is a block comment"
    =end
    class Window_Test
      def refresh
        text = "あいう".gsub(/"/, '')
        n = 10 / 2 / 1
        draw_text(0, 0, 100, 24, sprintf("%d歩", n))
        x = ?" == '"' ? :a : :b
        y = %w(a b "c)
        z = <<-EOS
    "heredoc text"
        EOS
        draw_text(0, 24, 100, 24, 'It\'s ok')
      end
    end
  RUBY
  scripts = [
    [12345678, s('Vocab'), Zlib::Deflate.deflate(script_code).force_encoding('ASCII-8BIT')],
    [23456789, s('Main'), Zlib::Deflate.deflate("rgss_main { SceneManager.run }\n").force_encoding('ASCII-8BIT')],
    [34567890, s(''), Zlib::Deflate.deflate('').force_encoding('ASCII-8BIT')]
  ]
  dump("Scripts.#{ext}", scripts)
end

build(:xp)
build(:vx)
build(:ace)
puts "fixtures written to #{OUT}"
