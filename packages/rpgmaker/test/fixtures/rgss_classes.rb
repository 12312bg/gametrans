# RGSS 类结构的最小模拟，供 gen.rb 生成测试数据和 verify.rb 校验回写结果。
$legacy = false

def s(str)
  str = str.dup
  $legacy ? str.force_encoding('ASCII-8BIT') : str.force_encoding('UTF-8')
end

class Table
  def initialize(x, y = 1, z = 1)
    @dim = z > 1 ? 3 : (y > 1 ? 2 : 1)
    @xsize, @ysize, @zsize = x, y, z
    @data = Array.new(x * y * z) { |i| i % 7 }
  end
  def _dump(_d = 0)
    [@dim, @xsize, @ysize, @zsize, @xsize * @ysize * @zsize].pack('L5') + @data.pack('S*')
  end
  def self._load(str)
    t = allocate
    dim, x, y, z, _n = str.unpack('L5')
    t.instance_variable_set(:@dim, dim)
    t.instance_variable_set(:@xsize, x)
    t.instance_variable_set(:@ysize, y)
    t.instance_variable_set(:@zsize, z)
    t.instance_variable_set(:@data, str[20..].unpack('S*'))
    t
  end
end

class Color
  def initialize(r, g, b, a = 255.0) @red, @green, @blue, @alpha = r.to_f, g.to_f, b.to_f, a.to_f end
  def _dump(_d = 0) [@red, @green, @blue, @alpha].pack('D4') end
  def self._load(str) new(*str.unpack('D4')) end
end

class Tone
  def initialize(r, g, b, gr = 0.0) @red, @green, @blue, @gray = r.to_f, g.to_f, b.to_f, gr.to_f end
  def _dump(_d = 0) [@red, @green, @blue, @gray].pack('D4') end
  def self._load(str) new(*str.unpack('D4')) end
end

module RPG
  class AudioFile
    def initialize(name = '', volume = 100, pitch = 100) @name = s(name); @volume = volume; @pitch = pitch end
  end
  class BGM < AudioFile; end
  class SE < AudioFile; end
  class MoveCommand
    def initialize(code = 0, parameters = []) @code = code; @parameters = parameters end
  end
  class MoveRoute
    def initialize; @repeat = true; @skippable = false; @wait = false; @list = [RPG::MoveCommand.new] end
  end
  class EventCommand
    def initialize(code = 0, indent = 0, parameters = []) @code = code; @indent = indent; @parameters = parameters end
  end
  class Event
    attr_accessor :id, :name, :pages
    def initialize(x, y)
      @id = 0; @name = s(''); @x = x; @y = y; @pages = [RPG::Event::Page.new]
    end
    class Page
      attr_accessor :list
      class Condition
        def initialize; @switch1_valid = false; @switch1_id = 1; @variable_value = 0; @self_switch_ch = s('A') end
      end
      class Graphic
        def initialize; @tile_id = 0; @character_name = s('Actor1'); @character_index = 0; @direction = 2; @pattern = 0 end
      end
      def initialize
        @condition = Condition.new; @graphic = Graphic.new; @move_type = 0; @move_speed = 3
        @move_route = RPG::MoveRoute.new; @walk_anime = true; @trigger = 0; @list = [RPG::EventCommand.new]
      end
    end
  end
  class Map
    attr_accessor :events, :display_name, :note
    def initialize(w, h)
      @tileset_id = 1; @width = w; @height = h; @scroll_type = 0; @autoplay_bgm = false
      @bgm = RPG::BGM.new('Town1'); @encounter_step = 30; @data = Table.new(w, h, 3); @events = {}
    end
  end
  class MapInfo
    def initialize(name, parent_id, order)
      @name = s(name); @parent_id = parent_id; @order = order; @expanded = false; @scroll_x = 320; @scroll_y = 240
    end
  end
  class CommonEvent
    def initialize(id, name, list) @id = id; @name = s(name); @trigger = 0; @switch_id = 1; @list = list end
  end
  class Troop
    class Page
      def initialize(list) @condition = nil; @span = 0; @list = list end
    end
    def initialize(id, name, pages) @id = id; @name = s(name); @members = []; @pages = pages end
  end
  class BaseItem
    class Feature
      def initialize(code, data_id, value) @code = code; @data_id = data_id; @value = value end
    end
  end
  class Actor < BaseItem; end
  class Item < BaseItem; end
  class Skill < BaseItem; end
  class State < BaseItem; end
  class System
    class Words; end
    class Terms; end
  end
end

